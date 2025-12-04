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
        const movementTypeStr = getText('.views-field-movement-type');
        const vesselName = getText('.views-field-vessel-name');
        const origin = getText('.views-field-origin');
        const destination = getText('.views-field-destination');
        const inPort = getText('.views-field-in-port');

        const vesselType = getText('.views-field-vessel-type');
        const vesselAgent = getText('.views-field-vessel-agent');
        const etaBradleys = getText('.views-field-eta-bradleys');

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
            // Default or skip? If we don't know what it is, maybe skip?
            // But previously it defaulted to Departure. Let's log a warning and skip to be safe, 
            // or default to Departure if we want to be aggressive.
            // Given the user's issue, let's skip unknown types to avoid bad data.
            console.warn(`Unknown movement type: ${movementTypeStr} for ${vesselName}`);
            return;
        }



        // Status - map 'In port' to something meaningful or just use it
        const status = `In Port: ${inPort}`;

        // Date Parsing: "Wed 26 Nov 13:00" -> Date object
        // We need to add the year.
        let scheduledTime: Date;
        try {
            const currentYear = new Date().getFullYear();
            // Append year to the string for parsing
            const dateStrWithYear = `${timeStr} ${currentYear}`;

            // Format seems to be "EEE d MMM HH:mm yyyy"
            // Parse the string into a Date object (which will be in local system time, likely UTC or whatever the server is set to)
            // But we know this time is actually Sydney time.
            const parsedLocal = parse(dateStrWithYear, 'EEE d MMM HH:mm yyyy', new Date());

            // Convert the "local" time (which is actually Sydney time) to a true Date object (UTC)
            // We tell fromZonedTime that 'parsedLocal' represents a time in 'Australia/Sydney'
            scheduledTime = fromZonedTime(parsedLocal, 'Australia/Sydney');

            // Handle year boundary (e.g. scraping in Dec for Jan dates)
            // If the parsed date is more than 6 months in the past, assume it's next year.
            // If it's more than 6 months in the future, assume it's last year (unlikely for schedule).
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

        vessels.push({
            vesselName,
            movementType,
            scheduledTime,
            origin,
            destination,
            vesselType,
            vesselAgent,
            etaBradleys,

            status,
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
