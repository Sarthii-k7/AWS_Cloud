const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const csvParser = require('csv-parser');
const fs = require('fs');

const port = 8000;
const app = express();

const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer({ storage: storage });

// Configure AWS SDK
AWS.config.update({ region: 'us-east-1' });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const ec2 = new AWS.EC2({ apiVersion: '2016-11-15' });
const s3 = new AWS.S3();
const inputBucket = '1229615688-in-bucket';
const outputBucket = '1229615688-out-bucket';
const requestQueueUrl = 'https://sqs.us-east-1.amazonaws.com/654654293616/1229615688-req-queue';
const responseQueueUrl = 'https://sqs.us-east-1.amazonaws.com/654654293616/1229615688-resp-queue';

const minInstances = 0; // Minimum number of instances
const maxInstances = 20; // Maximum number of instances
const highThreshold = 5; // Queue depth threshold for scaling out
const lowThreshold = 5; // Queue depth threshold for scaling in

let globalInstanceCount = 0;
const globalInstancesArray = [];
const userScript = `#!/bin/bash
cd /home/ubuntu/
sudo -u ubuntu node app.js`;

app.use(express.json());

// Middleware for parsing JSON and URL-encoded bodies
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.send('This is root!');
});

app.post('/', upload.single('inputFile'), async (req, res) => {
  try {
    const imageData = req.file;
    let fileName = 'test';

    if (!imageData || !imageData.originalname.endsWith('.jpg')) {
      throw new Error('Invalid file format. Please upload a .jpg file.');
    }

    fileName = imageData.originalname.split('.')[0];

    // Access various properties of the uploaded file
    // console.log('Field Name:', imageData.fieldname);
    // console.log('Original Name:', imageData.originalname);
    // console.log('cache: ', fileName, imageData);
    const base64data = Buffer.from(imageData.buffer, 'binary');

    // await s3.upload({ Bucket: inputBucket, Key: fileName, Body: base64data }).promise(),
    // await sqs.sendMessage({ QueueUrl: requestQueueUrl, MessageBody: JSON.stringify({ fileName }) }).promise()

    await s3.upload({ Bucket: inputBucket, Key: fileName, Body: base64data }).promise();
    console.log('S3 Upload Done!');

    await sqs.sendMessage({ QueueUrl: requestQueueUrl, MessageBody: JSON.stringify({ fileName }) }).promise();
    console.log('Message Sent');

    while(true) {
      const response = await sqs.receiveMessage({
        QueueUrl: responseQueueUrl,
        // MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20
      }).promise();
  
      let recognitionResult = '';
      let returnedFileName = '';
      // console.log('RESPONSE FROM QUEUE: ', response);
      if (response.Messages && response.Messages.length > 0) {
        const message = response.Messages[0];
        recognitionResult = JSON.parse(message.Body).result;
        returnedFileName = JSON.parse(message.Body).fileName;
  
        // Store recognition result in output S3 bucket
        console.log('Returned: ',returnedFileName, 'Original: ', fileName);
        if(returnedFileName == fileName) {
          await s3.putObject({
            Bucket: outputBucket,
            Key: fileName,
            Body: recognitionResult
          }).promise();
    
          const deleteMessageParams = {
            QueueUrl: responseQueueUrl,
            ReceiptHandle: message.ReceiptHandle
          };
          sqs.deleteMessage(deleteMessageParams, (err, data) => {
              if (err) {
                console.error('Error deleting message:', err);
              } else {
                console.log('Message deleted successfully:', message.MessageId);
              }
          });
          // Send recognition result back to the user
          res.status(200).send(`${fileName}:${recognitionResult}`);
          break;
        }
      }
    }
  } catch (error) {
    res.status(400).send(`Error: ${error.message}`);
  }
});

async function getQueueDepth(queueUrl) {
  const params = {
    QueueUrl: queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages']
  };
  const { Attributes } = await sqs.getQueueAttributes(params).promise();
  return parseInt(Attributes.ApproximateNumberOfMessages);
}

async function launchInstances(count) {
  const params = {
    ImageId: 'ami-0ec81dee489e18459',
    InstanceType: 't2.micro',
    MinCount: count,
    MaxCount: count,
    KeyName: 'my_key_pair',
    SubnetId: 'subnet-0554a5de3fa6c6d9e',
    SecurityGroupIds: ['sg-0a22b9d25a1783165', 'sg-0f638c21fd6664676'],
    UserData: Buffer.from(userScript).toString('base64'),
    TagSpecifications: [
      {
        ResourceType: "instance",
        Tags: [{
          Key: "Name",
          Value: `app-tier-instance-${globalInstanceCount}`
        }]
      }
    ]
  };
  return ec2.runInstances(params).promise();
}

async function terminateInstances(instanceIds) {
  const params = {
    InstanceIds: instanceIds
  };
  return ec2.terminateInstances(params).promise();
}

async function autoscale() {
  try {
    const queueDepth = await getQueueDepth(requestQueueUrl);
    const data = await ec2.describeInstances().promise();
    const currentInstances = data.Reservations.reduce((total, reservation) => {
      const runningInstances = reservation.Instances.filter(instance => instance.State.Name === 'running');
      return total.concat(runningInstances);
    }, []);
    console.log('Autoscaling called!', globalInstanceCount);
    // console.log('CURRENT: ', currentInstances);
    console.log("QUEUE Depth: ", queueDepth);
    // console.log('data: ', data);

    if (queueDepth > (highThreshold * globalInstanceCount) && currentInstances.length < maxInstances) {
      globalInstanceCount++;
      const currentInstances = await launchInstances(1);
      console.log('Current: ', currentInstances);
      let { InstanceId } = currentInstances['Instances'][0];
      console.log(`Scaled out: Launched new instance (${InstanceId}) and count ${globalInstanceCount}`);
      globalInstancesArray.push(InstanceId);
      console.log("ARRAY: ", globalInstancesArray);
    } else {
      // Get current instances if not scaling out
      console.log('Queue depth: ', queueDepth);
      console.log("instance count: ", currentInstances.length);
      if (queueDepth <= lowThreshold * globalInstanceCount && globalInstanceCount > minInstances) {
        // Scale in
        if(!(queueDepth > 0 && globalInstanceCount == 1)) {
          console.log("ARRAY CHECK: ", globalInstancesArray);
          const instanceIds = globalInstancesArray.pop();
          console.log('InSTANC ID: ', instanceIds);
          if(instanceIds && instanceIds.length) {
            globalInstanceCount--;
            await terminateInstances([instanceIds]);
            console.log('Scaled in: Terminated one instance');
          }
        }
      } else {
        console.log('No scaling action needed');
      }
    }
  } catch (error) {
    console.error('Error performing autoscaling:', error);
  }
}

// Periodically call autoscale function
setInterval(autoscale, 15000);

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});

