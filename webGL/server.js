const express = require('express');
const path = require('path');
const app = express();
const port = 9999;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Handle requests for index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});

