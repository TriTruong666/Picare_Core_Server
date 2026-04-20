const path = require('path');
const fs = require('fs');

const filesToTest = [
    './src/config/swagger.config.js',
    './src/middlewares/localhostOnly.middleware.js',
    './src/services/cache.service.js'
];

filesToTest.forEach(f => {
    const p = path.resolve(f);
    console.log(`Checking ${f} -> ${p}`);
    console.log(`Exists: ${fs.existsSync(p)}`);
    try {
        require(p);
        console.log(`Require ${f}: SUCCESS`);
    } catch (err) {
        console.log(`Require ${f}: FAILED - ${err.message}`);
    }
});
