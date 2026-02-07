#!/usr/bin/env node

const net = require('net');
const { execSync } = require('child_process');

const KB_HOST = process.env.KB_HOST || 'localhost';
const KB_PORT = parseInt(process.env.KB_PORT || '50051', 10);

console.log('='.repeat(60));
console.log('KB Service Diagnostic Tool');
console.log('='.repeat(60));
console.log();

// Test 1: Check Docker container status
console.log('1. Checking Docker container status...');
try {
  const dockerPs = execSync('docker ps -a --filter name=kb-service --format "{{.Names}}\t{{.Status}}"', { encoding: 'utf8' });
  if (dockerPs.trim()) {
    console.log('   ✓ Container found:');
    dockerPs.trim().split('\n').forEach(line => {
      console.log(`     ${line}`);
    });
  } else {
    console.log('   ✗ No kb-service container found');
    console.log('     Try: docker-compose up -d kb-service');
  }
} catch (error) {
  console.log('   ✗ Docker command failed:', error.message);
}
console.log();

// Test 2: Check if port is open
console.log('2. Checking if port is listening...');
try {
  const netstat = process.platform === 'win32'
    ? execSync(`netstat -an | findstr :${KB_PORT}`, { encoding: 'utf8' })
    : execSync(`netstat -an | grep :${KB_PORT}`, { encoding: 'utf8' });
  if (netstat.trim()) {
    console.log('   ✓ Port is in use:');
    netstat.trim().split('\n').forEach(line => {
      console.log(`     ${line}`);
    });
  } else {
    console.log('   ✗ Port is not listening');
  }
} catch (error) {
  console.log('   ✗ No listener on port', KB_PORT);
}
console.log();

// Test 3: Attempt TCP connection
console.log(`3. Testing TCP connection to ${KB_HOST}:${KB_PORT}...`);
const socket = new net.Socket();
let connectionSuccess = false;

socket.setTimeout(3000);

socket.on('connect', () => {
  console.log('   ✓ TCP connection established');
  connectionSuccess = true;

  // Test 4: Send a test request
  console.log();
  console.log('4. Sending test search request...');
  const request = JSON.stringify({
    endpoint: '/search',
    params: { query: 'test', top_k: 1 }
  });
  socket.write(request);
  socket.end();
});

let responseData = '';
socket.on('data', (data) => {
  responseData += data.toString();
});

socket.on('end', () => {
  if (connectionSuccess) {
    try {
      const response = JSON.parse(responseData);
      console.log('   ✓ Received valid JSON response');
      console.log('   Response:', JSON.stringify(response, null, 2));
      console.log();
      console.log('='.repeat(60));
      console.log('RESULT: All KB service checks passed! ✓');
      console.log('='.repeat(60));
    } catch (error) {
      console.log('   ✗ Invalid response format:', error.message);
      console.log('   Raw response:', responseData);
    }
  }
  process.exit(0);
});

socket.on('error', (error) => {
  console.log('   ✗ Connection failed');
  console.log('     Error:', error.message);
  console.log('     Code:', error.code);

  if (error.code === 'ECONNREFUSED') {
    console.log();
    console.log('='.repeat(60));
    console.log('DIAGNOSIS: KB service is not running');
    console.log('='.repeat(60));
    console.log();
    console.log('Solution:');
    console.log('  1. Start the service: docker-compose up -d kb-service');
    console.log('  2. Check logs: docker logs dev-bot-kb-service');
    console.log('  3. Verify port mapping in docker-compose.yml');
  } else if (error.code === 'ETIMEDOUT') {
    console.log();
    console.log('='.repeat(60));
    console.log('DIAGNOSIS: Connection timeout (firewall or network issue)');
    console.log('='.repeat(60));
  } else if (error.code === 'EHOSTUNREACH') {
    console.log();
    console.log('='.repeat(60));
    console.log('DIAGNOSIS: Host unreachable');
    console.log('='.repeat(60));
    console.log();
    console.log('Check KB_HOST environment variable:', KB_HOST);
  }

  process.exit(1);
});

socket.on('timeout', () => {
  console.log('   ✗ Connection timeout');
  socket.destroy();

  console.log();
  console.log('='.repeat(60));
  console.log('DIAGNOSIS: Service not responding within 3 seconds');
  console.log('='.repeat(60));

  process.exit(1);
});

socket.connect(KB_PORT, KB_HOST);
