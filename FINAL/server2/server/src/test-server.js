import express from 'express';

const app = express();
const PORT = process.env.PORT || 4000;

app.get('/', (req, res) => {
  res.send('Test server is working on port ' + PORT);
});

app.listen(PORT, () => {
  console.log(`Test server running on http://localhost:${PORT}`);
  console.log(`PORT environment variable: ${process.env.PORT}`);
  console.log(`Final PORT value: ${PORT}`);
});
