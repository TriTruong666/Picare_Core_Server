const Redis = require('ioredis');

async function testRedis() {
    const passwords = ['M@tkhau123', 'picare_dev', 'password', '123456'];
    
    for (const pass of passwords) {
        console.log(`Testing with password: ${pass}`);
        const redis = new Redis({
            host: 'localhost', port: 6379, password: pass, retryStrategy: () => null
        });
        
        try {
            await redis.ping();
            console.log(`SUCCESS with password: ${pass}`);
            process.exit(0);
        } catch (err) {
            console.log(`FAILED with password: ${pass} - ${err.message}`);
        } finally {
            redis.disconnect();
        }
    }
    process.exit(1);
}

testRedis();
