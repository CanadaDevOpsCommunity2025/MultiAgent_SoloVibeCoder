// Simple test to verify Task Router basic functionality
const { TaskRouterApp } = require('./dist/index');

async function basicTest() {
  console.log('🧪 Running basic Task Router test...');
  
  try {
    // Test that the app can be instantiated
    const app = new TaskRouterApp();
    console.log('✅ TaskRouterApp instantiated successfully');
    
    // Test configuration loading
    const config = require('./dist/config').config;
    console.log('✅ Configuration loaded:', {
      nodeEnv: config.server.nodeEnv,
      port: config.server.port
    });
    
    console.log('✅ Basic test passed - TaskRouter is ready!');
  } catch (error) {
    console.error('❌ Basic test failed:', error.message);
    process.exit(1);
  }
}

basicTest(); 