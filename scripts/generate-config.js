const fs = require('fs');
require('dotenv').config({ path: '.env' });

const config = `
window.SUPABASE_URL = '${process.env.SUPABASE_URL}';
window.SUPABASE_ANON_KEY = '${process.env.SUPABASE_ANON_KEY}';
`;

fs.writeFileSync('config.js', config);
console.log('config.js generated successfully.');
