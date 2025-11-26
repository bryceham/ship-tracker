const TARGET_URL = 'https://www.portauthoritynsw.com.au/newcastle-harbour/daily-vessel-movements/';
import { writeFile } from 'fs/promises';

async function main() {
    console.log(`Fetching ${TARGET_URL}...`);
    const response = await fetch(TARGET_URL);
    const html = await response.text();
    await writeFile('dump.html', html);
    console.log('Dumped to dump.html');
}

main();
