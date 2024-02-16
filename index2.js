const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const PORT = 3000;
const csvName = '1000.csv';

const upload = multer();

let csvData = {};
fs.createReadStream(csvName)
  .pipe(csv())
  .on('data', (row) => {
    csvData[row['Image']] = row['Results'];
  })
  .on('end', () => {
    console.log('CSV file successfully processed.');
  })
  .on('error', (error) => {
    csvData = {};
    console.log('Error Occured while reading csv file: ', error);
  });

app.get('/', (req, res) => {
  res.send('This is root2!');
});

app.post('/', upload.single('inputFile'), (req, res) => {
  try {
    const imageData = req.file;

    if (!imageData || !imageData.originalname.endsWith('.jpg')) {
      throw new Error('Invalid file format. Please upload a .jpg file.');
    }

    const fileName = imageData.originalname.split('.')[0];
    const personName = csvData[fileName] || '';

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

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
