import { scrapeVessels } from '../src/services/scraper';

async function main() {
    console.log('Running scraper in dry-run mode...');
    const vessels = await scrapeVessels(true);
    console.log('Scraped Data:', JSON.stringify(vessels, null, 2));
}

main();
