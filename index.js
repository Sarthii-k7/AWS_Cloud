const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const csvParser = require('csv-parser');

const port = 8080;
const app = express();

// const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer();

const s3 = new AWS.S3();
const s3BucketName = 'myprojectpartone';
const s3Key = '1000.csv';
const s3Params = { Bucket: s3BucketName, Key: s3Key };

// In-memory cache to store CSV data
let csvCache = null;

app.use(express.json());

const init = async () => {
  try {
    const s3Data = await s3.getObject(s3Params).promise();
    console.log('s3 data recieved!');

    csvCache = await new Promise((resolve, reject) => {
      let data_object = {};
      const parser = csvParser();

      parser
        .on('data', (row) => {
          data_object[row['Image']] = row['Results'];
        })
        .on('end', () => {
          resolve(data_object);
        })
        .on('error', (error) => {
          reject(error);
        });

      parser.write(s3Data.Body);
      parser.end();
    });
    console.log('CSV file successfully processed.');
  } catch (error) {
    console.error('Error processing CSV file:', error);
    csvCache = {};
  }
};

init();

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

    const personName = csvCache[fileName] || '';
    if (personName.length) {
      res.send(`${fileName}:${personName}`);
    } else {
      // If no match found
      console.log(`No match found for ${fileName}`);
      res.status(404).send(`No match found for ${fileName}`);
    }
  } catch (error) {
    res.status(400).send(`Error: ${error.message}`);
  }
});


app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});

