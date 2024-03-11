const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const csvParser = require('csv-parser');
const fs = require('fs');

const port = 8080;
const app = express();

const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer({ storage: storage });

// Configure AWS SDK
AWS.config.update({ region: 'us-east-1' });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const s3 = new AWS.S3();
const inputBucket = '1229615688-in-bucket';
const outputBucket = '1229615688-out-bucket';
const requestQueueUrl = 'https://sqs.us-east-1.amazonaws.com/654654293616/1229615688-req-queue';
const responseQueueUrl = 'https://sqs.us-east-1.amazonaws.com/654654293616/1229615688-resp-queue';

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

    const response = await sqs.receiveMessage({
      QueueUrl: responseQueueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20
    }).promise();

    let recognitionResult = '';
    console.log('RESPONSE FROM QUEUE: ', response);
    if (response.Messages && response.Messages.length > 0) {
      const message = response.Messages[0];
      recognitionResult = JSON.parse(message.Body).result;

      // Store recognition result in output S3 bucket
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
    }

    // Send recognition result back to the user
    res.status(200).send(`${fileName}:${recognitionResult}`);
  } catch (error) {
    res.status(400).send(`Error: ${error.message}`);
  }
});


app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});

