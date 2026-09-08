import {
  StreetEasyClient,
  Areas,
  Amenities,
  SearchRentalListing,
} from "streeteasy-api";
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const STATE_FILE = path.resolve("state.json");
const INITIAL_RUN_NOTIFIES = process.env.INITIAL_RUN_NOTIFIES === "true";
const PUSHOVER_TOKEN = process.env.PUSHOVER_TOKEN;
const PUSHOVER_USER = process.env.PUSHOVER_USER;
const PUSHOVER_DEVICE = process.env.PUSHOVER_DEVICE;


type WatcherState = {
  initializedAt: string;
  seenListingIds: string[];
};

function listingUrl(listing: SearchRentalListing): string {
  return `https://streeteasy.com${listing.urlPath}`;
}

function formatListing(listing: SearchRentalListing): string {
  return [
    `${listing.street}${listing.unit ? ` ${listing.unit}` : ""}`,
    listingUrl(listing),
    `StreetEasy ID: ${listing.id}`,
  ].join("\n");
}

async function loadState(): Promise<WatcherState | null> {
  if (!existsSync(STATE_FILE)) {
    return null;
  }

  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as WatcherState;

    if (!Array.isArray(parsed.seenListingIds)) {
      throw new Error("state.json has no seenListingIds array");
    }

    return parsed;
  } catch (error) {
    throw new Error(
      `Could not read ${STATE_FILE}: ${error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function saveState(listingIds: string[]): Promise<void> {
  const state: WatcherState = {
    initializedAt: new Date().toISOString(),
    seenListingIds: [...new Set(listingIds)],
  };

  const tempFile = `${STATE_FILE}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempFile, STATE_FILE);
}

async function notify(
  message: string,
  options: {
    title?: string;
    url?: string;
    urlTitle?: string;
  } = {},
): Promise<void> {
  if (!PUSHOVER_TOKEN || !PUSHOVER_USER) {
    console.warn(
      "PUSHOVER_TOKEN and/or PUSHOVER_USER are not configured; notification was not sent.",
    );
    console.log(message);
    return;
  }

  const body = new URLSearchParams({
    token: PUSHOVER_TOKEN,
    user: PUSHOVER_USER,
    message,
    title: options.title ?? "StreetEasy watcher",
    sound: "incoming",
    priority: "0",
  });

  if (PUSHOVER_DEVICE) {
    body.set("device", PUSHOVER_DEVICE);
  }

  if (options.url) {
    body.set("url", options.url);
  }

  if (options.urlTitle) {
    body.set("url_title", options.urlTitle);
  }

  const response = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");

    throw new Error(
      `Pushover delivery failed: ${response.status} ${response.statusText} ${responseBody}`,
    );
  }
}

async function getSearchResults(client: StreetEasyClient) {
  const response = await client.searchRentals({
    sorting: {
      attribute: "LISTED_AT",
      direction: "DESCENDING",
    },
    adStrategy: "NONE",
    filters: {
      areas: [Areas.RIDGEWOOD, Areas.BUSHWICK],
      rentalStatus: "ACTIVE",
      bedrooms: {
        lowerBound: 3,
        upperBound: null,
      },
      price: {
        lowerBound: null,
        upperBound: 4200,
      },
      amenities: [Amenities.DISHWASHER],
    },
    perPage: 50,
    page: 1,
    userSearchToken: "6acc6bf8-a96c-4883-9a20-d9712d7fa26f",
  });

  return {
    totalCount: response.searchRentals.totalCount,
    listings: response.searchRentals.edges.map((edge) => edge.node),
  };
}

async function main(): Promise<void> {
  const client = new StreetEasyClient();
  const previousState = await loadState();
  const { totalCount, listings } = await getSearchResults(client);

  const currentIds = listings.map((listing) => listing.id);
  console.log(
    `Found ${totalCount} active matching listing(s); ${listings.length} returned on page 1.`,
  );

  if (!previousState) {
    await saveState(currentIds);

    const message = [
      "StreetEasy watcher initialized.",
      `Saved ${currentIds.length} listing IDs as the baseline.`,
      "Future runs will notify only about newly observed results.",
    ].join("\n");

    if (INITIAL_RUN_NOTIFIES) {
      await notify(
        `${message}\n\nCurrent matches:\n\n${listings
          .map(formatListing)
          .join("\n\n")}`,
      );
    } else {
      console.log(message);
    }

    return;
  }

  const previousIds = new Set(previousState.seenListingIds);
  const newListings = listings.filter(
    (listing) => !previousIds.has(listing.id),
  );

  if (newListings.length === 0) {
    console.log("No new listings.");
  } else {
    console.log(`Found ${newListings.length} new listing(s). Sending notifications...`);

    for (const listing of newListings) {
      const address = `${listing.street}${listing.unit ? ` ${listing.unit}` : ""}`;
      const url = listingUrl(listing);

      await notify(
        [
          address,
          "",
          "A new rental matching your StreetEasy search was found.",
          url,
        ].join("\n"),
        {
          title: "New StreetEasy rental",
          url,
          urlTitle: `Open ${address}`,
        },
      );
    }
  }

  // Keep the union, not just today's first page. This prevents alerting again
  // if a listing falls off page 1 and later reappears there.
  await saveState([...previousState.seenListingIds, ...currentIds]);
}

main().catch((error) => {
  console.error(
    "StreetEasy watcher failed:",
    error instanceof Error ? error.stack ?? error.message : error,
  );
  process.exitCode = 1;
});
