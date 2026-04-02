// 测试截图功能
const path = require('path');
const fs = require('fs');

// 加载原生模块
const binaryName = 'screenshot-native.linux-x64-gnu.node';
const modulePath = path.join(__dirname, 'native', binaryName);

console.log('Loading module from:', modulePath);
console.log('Module exists:', fs.existsSync(modulePath));

const native = require(modulePath);

console.log('\n=== Displays ===');
const displays = native.getDisplays();
console.log(JSON.stringify(displays, null, 2));

console.log('\n=== Capturing all displays ===');
const image = native.captureAllDisplays();
console.log('Image size:', image.width, 'x', image.height);
console.log('Data length:', image.data.length);

// 保存测试
const testPath = path.join(__dirname, 'test-screenshot.png');
native.saveToFile(image.data, testPath);
console.log('\nSaved to:', testPath);
console.log('File exists:', fs.existsSync(testPath));
console.log('File size:', fs.statSync(testPath).size, 'bytes');
