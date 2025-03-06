# Browser Automation & Tracing Demo

A demonstration project showcasing browser automation, tracing capabilities, and OS information gathering.

## Overview

This project consists of a server and client component that work together to demonstrate browser automation techniques. It serves as a practical example for developers looking to implement automated browser interactions, tracing, and OS information collection.

## Features

- **Browser Automation**: Programmatically control browser behavior
- **Browser Tracing**: Collect and analyze browser performance metrics
- **OS Information**: Gather system details for diagnostics and compatibility

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS version recommended)

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/browser-automation-demo.git
   cd browser-automation-demo
   ```

2. Install dependencies:
   ```
   npm install
   ```

### Configuration

Before running the client, you need to update the server URL in `client.js`:

```javascript
// Update this line with your server's IP address
const WEBGL_URL = 'http://192.168.1.252:9999/index-webgl.html';
```

### Usage

1. Start the server:
   ```
   node server.js
   ```
   You should see: `Server running at http://0.0.0.0:9999`

2. In a separate terminal, start the client:
   ```
   node client.js
   ```

## Technical Details

### Server Component

The server hosts the WebGL content that the client will interact with. It runs on port 9999 and binds to all available network interfaces.

### Client Component

The client uses browser automation to interact with the server's WebGL content. It demonstrates how to:

- Launch and control a browser instance
- Navigate to specific URLs
- Execute scripts within the browser context
- Collect tracing information
- Gather OS-specific information
- Automatically generate a dashboard to visualize the data collected 

## Contributing

Please feel free to submit a pull request or open an issue to discuss potential improvements.

## License

[MIT License](LICENSE)
