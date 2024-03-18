const AWS = require('aws-sdk');
const { spawn, execSync } = require('child_process');
const { createPool } = require('generic-pool');
const fs = require('fs');
const path = require('path');

// Configure AWS SDK
AWS.config.update({ region: 'us-east-1' });
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const s3 = new AWS.S3();

const requestQueueUrl = 'https://sqs.us-east-1.amazonaws.com/654654293616/1229615688-req-queue';
const responseQueueUrl = 'https://sqs.us-east-1.amazonaws.com/654654293616/1229615688-resp-queue';
const inputBucket = '1229615688-in-bucket';

const receiveMessageParams = {
  QueueUrl: requestQueueUrl,
  MaxNumberOfMessages: 1,
  WaitTimeSeconds: 20
};

async function receiveMessages() {
    while (true) {
        try {
            const data = await sqs.receiveMessage(receiveMessageParams).promise();
    
            if (data.Messages && data.Messages.length > 0) {
                const message = data.Messages[0];
                const fileName = JSON.parse(message.Body).fileName;
                console.log('MESSAGE RECIEVED: ', message);
    
                // Fetch image from input S3 bucket
                const getObjectParams = { Bucket: inputBucket, Key: fileName };
                const image = await s3.getObject(getObjectParams).promise();
                const imageData = image.Body;
    
                // console.log('Image found: ', imageData);
                const localDirectoryPath = `/home/ubuntu/downloads`;
                if (!fs.existsSync(localDirectoryPath)) {
                    fs.mkdirSync(localDirectoryPath, { recursive: true }); // Create directory if it doesn't exist
                }

                const localImagePath = path.join(localDirectoryPath, `${fileName}.jpg`);
                fs.writeFileSync(localImagePath, imageData); 

                // const recognitionResult = await performModelInference(imageData);
                const result = execSync(`python3 face_recognition.py ${localImagePath}`);
                console.log('result: ',result);
                const recognitionResult = result.toString('utf-8').trim();
      
                console.log('Recognition: ', recognitionResult);
                fs.unlinkSync(localImagePath);

                const sendMessageParams = {
                    QueueUrl: responseQueueUrl,
                    MessageBody: JSON.stringify({ fileName: fileName, result: recognitionResult })
                };
                await sqs.sendMessage(sendMessageParams).promise();
                const deleteMessageParams = {
                    QueueUrl: requestQueueUrl,
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
        } catch (err) {
            console.error('Error receiving messages:', err);
        }   
    }
}

// Start listening for messages
receiveMessages().catch(err => console.error('Unhandled error:', err));