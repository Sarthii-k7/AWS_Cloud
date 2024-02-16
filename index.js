const express = require('express');
const multer = require('multer');
const AWS = require('aws-sdk');
const csvParser = require('csv-parser');


const port = 8080;
const app = express();

const storage = multer.memoryStorage(); // Store the file in memory
const upload = multer({ storage: storage });

const s3 = new AWS.S3();
const s3BucketName = 'myprojectpartone';
const s3Key = '1000.csv';

// In-memory cache to store CSV data
let csvCache = null;

app.use(express.json());

// const csvFilePath = 'image_100.csv';

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
    // console.log('cache', csvCache, fileName);

    if (!csvCache) {
      const s3Params = { Bucket: s3BucketName, Key: s3Key };
      const s3Data = await s3.getObject(s3Params).promise();
      console.log('s3 data recieved!');

      // Parse CSV data and store it in the cache
      csvCache = await new Promise((resolve, reject) => {
        // const data = [];
        let data_object = {};
        const parser = csvParser();

        parser
        .on('data', (row) => {
          data_object[row['Image']] = row['Results'];
          // data.push(row);
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
    }

    // Find the corresponding image for the given name in the CSV data
    // console.log('csvCache reached ', Object.keys(csvCache).length);
    // const match = csvCache.find(({Image, Results}) => Image === fileName) || {};
    const personName = csvCache[fileName] || '';
    // console.log('finding: ',personName);
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

