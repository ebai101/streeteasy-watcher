import {
  StreetEasyClient,
  Areas,
  Amenities,
  SearchRentalListing,
  DetailedRentalListing,
} from "streeteasy-api";

function logListing(listing: SearchRentalListing): void {
  console.log(`
${listing.street} ${listing.unit}
https://streeteasy.com${listing.urlPath}
${listing.id}
`);

}

async function main() {
  const client = new StreetEasyClient();

  try {
    const response = await client.searchRentals({
      sorting: {
        attribute: 'LISTED_AT',
        direction: 'DESCENDING'
      },
      adStrategy: 'NONE',
      filters: {
        areas: [Areas.RIDGEWOOD, Areas.BUSHWICK],
        rentalStatus: 'ACTIVE',
        bedrooms: {
          lowerBound: 3,
          upperBound: null,
        },
        price: {
          lowerBound: null,
          upperBound: 4200
        },
        amenities: [Amenities.DISHWASHER]
      },
      perPage: 50,
      page: 1,
      userSearchToken: '6acc6bf8-a96c-4883-9a20-d9712d7fa26f'
    });

    // console.log('Full response:', JSON.stringify(response, null, 2));
    console.log(`Found ${response.searchRentals.totalCount} listings`);
    console.log('---');

    // Print each listing
    for (const edge of response.searchRentals.edges) {
      const listing = edge.node;
      logListing(listing);
      const details = (await client.getRentalListingDetails(listing.id)).rentalByListingId;
      console.log(details.createdAt)
    }
  } catch (error) {
    console.error('Error details:', error);
    console.error('Error searching rentals:', error instanceof Error ? error.message : String(error));
  }
}

main().catch(console.error);

