const bcrypt = require('bcrypt');
const saltRounds = 10;
const myPlaintextPassword = 'password';

bcrypt.hash(myPlaintextPassword, saltRounds, function(err, hash) {
    if (err) {
        console.error('Bcrypt error:', err);
        process.exit(1);
    }
    console.log('Bcrypt hash successful:', hash);
    process.exit(0);
});
