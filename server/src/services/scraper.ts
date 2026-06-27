import * as cheerio from 'cheerio';
import { ScrapedVessel, processScrapedData } from './diff-engine';
import { parse } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

const TARGET_URL = 'https://www.portauthoritynsw.com.au/newcastle-harbour/daily-vessel-movements/';

export async function fetchAndParseVessels(): Promise<ScrapedVessel[]> {
    console.log(`Fetching ${TARGET_URL}...`);
    const response = await fetch(TARGET_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    const html = await response.text();
    const $ = cheerio.load(html);
    const vessels: ScrapedVessel[] = [];

    // Select the specific table body rows
    $('.view-content table tbody tr').each((i: number, el: any) => {
        const $row = $(el);

        // Extract text with some cleanup
        const getText = (selector: string) => {
            const cell = $row.find(selector);
            // Replace <br> with space
            cell.find('br').replaceWith(' ');
            return cell.text().trim();
        };

        const timeStr = getText('.views-field-time');
        const expectedTimeStr = getText('.views-field-eta-bradleys');
        const movementTypeStr = getText('.views-field-movement-type');
        const vesselName = getText('.views-field-vessel-name');
        const vesselType = getText('.views-field-vessel-type');
        const agent = getText('.views-field-vessel-agent');
        const origin = getText('.views-field-origin');
        const destination = getText('.views-field-destination');
        const inPort = getText('.views-field-in-port');

        if (!vesselName || !timeStr) return;

        let movementType: 'Arrival' | 'Departure' | 'Shift';
        const lowerType = movementTypeStr.toLowerCase();
        if (lowerType.includes('arr')) {
            movementType = 'Arrival';
        } else if (lowerType.includes('dep')) {
            movementType = 'Departure';
        } else if (lowerType.includes('shift')) {
            movementType = 'Shift';
        } else {
            console.warn(`Unknown movement type: ${movementTypeStr} for ${vesselName}`);
            return;
        }

        // Status - map 'In port' to something meaningful or just use it
        const status = `In Port: ${inPort}`;

        // Date Parsing: "Wed 26 Nov 13:00" -> Date object
        let scheduledTime: Date;
        try {
            const currentYear = new Date().getFullYear();
            const dateStrWithYear = `${timeStr} ${currentYear}`;
            const parsedLocal = parse(dateStrWithYear, 'EEE d MMM HH:mm yyyy', new Date());
            scheduledTime = fromZonedTime(parsedLocal, 'Australia/Sydney');

            // Handle year boundary
            const now = new Date();
            if (scheduledTime.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
                scheduledTime.setFullYear(currentYear + 1);
            } else if (scheduledTime.getTime() > now.getTime() + 180 * 24 * 60 * 60 * 1000) {
                scheduledTime.setFullYear(currentYear - 1);
            }

            if (isNaN(scheduledTime.getTime())) {
                console.warn(`Invalid date: ${timeStr} for ${vesselName}`);
                return;
            }
        } catch (e) {
            console.warn(`Failed to parse date: ${timeStr}`);
            return;
        }

        // Parse expectedTime if not 'N/A'
        let expectedTime: Date | null = null;
        if (expectedTimeStr && expectedTimeStr.toLowerCase() !== 'n/a') {
            try {
                const currentYear = new Date().getFullYear();
                const dateStrWithYear = `${expectedTimeStr} ${currentYear}`;
                const parsedLocal = parse(dateStrWithYear, 'EEE d MMM HH:mm yyyy', new Date());
                expectedTime = fromZonedTime(parsedLocal, 'Australia/Sydney');

                const now = new Date();
                if (expectedTime.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
                    expectedTime.setFullYear(currentYear + 1);
                } else if (expectedTime.getTime() > now.getTime() + 180 * 24 * 60 * 60 * 1000) {
                    expectedTime.setFullYear(currentYear - 1);
                }
            } catch (e) {
                console.warn(`Failed to parse expected time: ${expectedTimeStr}`);
            }
        }

        vessels.push({
            vesselName,
            movementType,
            scheduledTime,
            origin,
            destination,
            status,
            expectedTime,
            vesselType,
            agent,
        });
    });

    return vessels;
}

export async function scrapeVessels(dryRun = false) {
    try {
        const vessels = await fetchAndParseVessels();
        console.log(`Found ${vessels.length} vessels.`);

        if (dryRun) {
            console.log('Dry run: skipping DB processing.');
            return vessels;
        }

        await processScrapedData(vessels);

    } catch (error) {
        console.error('Scraper error:', error);
    }
}
