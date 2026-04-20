const Redis = require('ioredis');

async function testRedis() {
    console.log('Testing Redis connection...');
    
    const redisWithPass = new Redis({
        host: 'localhost',
        port: 6379,
        password: 'picare_redis_pass_1',
        retryStrategy: () => null // Don't retry
    });

    redisWithPass.on('error', (err) => {
        console.log('Redis with pass error:', err.message);
    });

    const redisWithoutPass = new Redis({
        host: 'localhost',
        port: 6379,
        retryStrategy: () => null
    });

    redisWithoutPass.on('error', (err) => {
        console.log('Redis without pass error:', err.message);
    });

    setTimeout(() => {
        console.log('Timeout - closing');
        redisWithPass.disconnect();
        redisWithoutPass.disconnect();
        process.exit(0);
    }, 2000);
}

testRedis();
