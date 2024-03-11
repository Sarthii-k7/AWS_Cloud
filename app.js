const AWS = require('aws-sdk');
const { spawn } = require('child_process');
const { createPool } = require('generic-pool');

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
                const imageData = image.Body.toString();
    
                // console.log('Image found: ', imageData);
                // Perform model inference here (replace with your logic)
                const recognitionResult = await performModelInference(imageData);
    
                console.log('Recognition: ', recognitionResult);
    
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

const pythonPool = createPool({
    create: () => {
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python3', ['face_recognition.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
  
        // Handle errors
        pythonProcess.stderr.on('data', data => {
          console.error('Python script error:', data.toString());
          reject(new Error(data.toString()));
        });
  
        resolve(pythonProcess);
      });
    },
    destroy: (pythonProcess) => {
      // Terminate the Python process when it's no longer needed
      pythonProcess.kill();
    },
    validate: (pythonProcess) => {
      // Check if the Python process is still alive and usable
      return pythonProcess && !pythonProcess.killed;
    },
    max: 5 // Maximum number of Python processes in the pool
});

const performModelInference = async (imageData) => {
    const pythonProcess = await pythonPool.acquire();

    return new Promise((resolve, reject) => {

        let result = '';
        pythonProcess.stdout.on('data', data => {
            result += data.toString();
        });

        // Handle errors
        pythonProcess.stderr.on('data', data => {
            console.error('Python script error:', data.toString());
            reject(new Error(data.toString()));
        });

        // Handle process exit
        pythonProcess.on('exit', code => {
            if (code !== 0) {
                console.error(`Python script exited with code ${code}`);
                reject(new Error(`Python script exited with code ${code}`));
            } else {
                resolve(result.trim());
            }

            // Release the Python process back to the pool
            pythonPool.release(pythonProcess);
        });
        
        pythonProcess.stdin.write(imageData);
        pythonProcess.stdin.end();
        // setTimeout(() => {
        //     resolve('Final');
        // }, 3000);
    });
}

// Start listening for messages
receiveMessages().catch(err => console.error('Unhandled error:', err));