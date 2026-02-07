const net = require('net');

const KB_HOST = process.env.KB_HOST || 'localhost';
const KB_PORT = parseInt(process.env.KB_PORT || '50051', 10);

console.log(`Testing connection to KB service at ${KB_HOST}:${KB_PORT}...`);

const socket = new net.Socket();
let responseData = '';

socket.on('connect', () => {
  console.log('✓ Successfully connected to KB service');
  const request = JSON.stringify({ endpoint: '/search', params: { query: 'test', top_k: 1 } });
  socket.write(request);
  socket.end();
});

socket.on('data', (data) => {
  responseData += data.toString();
});

socket.on('end', () => {
  console.log('✓ Connection closed');
  try {
    const response = JSON.parse(responseData);
    console.log('✓ Response parsed successfully:', response);
  } catch (error) {
    console.error('✗ Failed to parse response:', error.message);
    console.error('Raw response:', responseData);
  }
});

socket.on('error', (error) => {
  console.error('✗ Socket error:', error.message);
  console.error('Error code:', error.code);
  console.error('Full error:', error);
});

socket.on('timeout', () => {
  console.error('✗ Connection timeout');
  socket.destroy();
});

socket.setTimeout(5000);
socket.connect(KB_PORT, KB_HOST);
