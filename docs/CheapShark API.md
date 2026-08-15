[CheapShark](https://www.cheapshark.com/) is a price comparison website for digital PC Games. We keep track of prices across multiple stores including Steam, GreenManGaming, Fanatical, and many others.

We offer a fully documented public API for developers to use CheapShark pricing data on their own app or website.

## 📌 Important Usage Notes

The API is completely free, the only condition being that you **use CheapShark links when sending users to deals** (see details in **Deals** section below). This is how we pay for hosting and development! 😉

While not required, it is always appreciated if you mention somewhere that your app or site is making use of the CheapShark API.

## 🔑 Authorization, Rate Limiting & Caching

Two of the most common questions we see are regarding API Keys and Rate Limits. The API is completely public, **no authorization or API Key is needed**. You can get started right away!

**Note**: we do require sending a [User-Agent](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/User-Agent) on your incoming requests. Ideally it should be descriptive and specific to your application in order to avoid being accidentally blocked. Including a contact email is also helpful e.g. `MyApp/1.0 (contact@example.com)`

To ensure server performance, we rate limit API calls. If you make too many requests in too short of time, you will receive a `429` HTTP response status code and be _**temporarily**_ blocked. The ban will be automatically lifted after it expires. To see the remaining ban time (in seconds) check the `Retry-After` HTTP response header on any blocked request. All API clients are subject to the same limits. For this reason, during development you may wish to create and use a Mock API instead ([Postman offers this feature](https://www.postman.com/features/mock-api/)).

In general the API is designed to be called directly in response to user input / queries in your application. For example, a user searching for a particular game or browsing through pages of deals. Excessive automated requests to build a cached catalog of data **will run into rate limiting issues** (including a _permenant_ block) and should be avoided. We do this to maintain server performance and keep the service free and open for everyone. If you have a specific use-case that is being blocked, please reach out and we are happy to work with you!

The API fully supports [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS), so requests should come directly from the user's browser or app (whenever possible). This will help avoid most rate limiting issues.

## 🙋♂️Help & Support

For some real-world examples of this API in action, we suggest you check out the [CheapShark](https://www.cheapshark.com/) website itself. Using your browser's [DevTools](https://developer.chrome.com/docs/devtools/), you can inspect how various pages and interactions use the API.

If you run into any issues, need help with your implementation, or just want to share what you'll be using the API for, feel free to get in touch with us anytime!

We're always happy to help on our [Discord](https://discord.gg/cheapshark)'s dedicated **#api-help** channel or via email - [admin@cheapshark.com](mailto:admin@cheapshark.com)

## 📢Updates

We'll occasionally share important changes or news regarding the API via the **#api-announcements** channel on our [Discord](https://discord.gg/cheapshark) server. Be sure to right-click and set "Notification Settings" to "All Messages" on the channel if you'd like to stay informed!

## 

💲 Deals

## 

💲 Deals

Each deal is the price (and metadata) for a game at a particular store. For example: if a game is available on 3 stores, it will have 3 separate deal entries, one for each store the game is listed on. For reference, deal entries still exist even when the game is at full price.

On your website or app, you will use the CheapShark redirect page to link users to a specific deal:

`https://www.cheapshark.com/redirect?dealID={id}`

**📌 Important Note**: The redirect page is _not_ an API endpoint and will **block** automated access. It is designed only to link and send your users to deals. If your use-case _requires_ automation, please get in touch for options!

___

In general, pricing information is updated from stores about once per hour. However this can fluctuate depending on a number of factors.

The deal rating property provides a quick way to compare how 'good' a deal is. It is normalized on a scale from 0 to 10.

Pricing data is always in **USD**. All date fields (releaseDate, lastChange, etc.) are returned in [Unix Timestamp](https://www.unixtimestamp.com/) format, in seconds. Boolean flags are a `0` or a `1`.

### GETList of Deals

https://www.cheapshark.com/api/1.0/deals?storeID=1&upperPrice=15

Get a paged list of deals matching any number of criteria, all the following filtering parameters are optional.

PARAMS

storeID

1

`(optional, string)`

Comma separated list of store ID's to filter on. If not set, all stores will be shown.

pageNumber

`(optional, integer)` Default `0`

The requested page number, value is 0 indexed.

The `X-Total-Page-Count` HTTP header on the response will give you the max value for this parameter.

pageSize

`(optional, integer)` Default `60`

The number of deals per page, max value of `60`

sortBy

`(optional, string)` Default `DealRating`

Criteria to sort the list by, possible values - `DealRating`, `Title`, `Savings`, `Price`, `Metacritic`, `Reviews`, `ReviewCount`, `Release`, `Store`, `Recent`

desc

`(optional, boolean)` Default `0`

Determines sort direction

lowerPrice

`(optional, integer)` Default `0`

Only returns deals with a price _greater than_ this value

upperPrice

15

`(optional, integer)`

Only returns deals with a price _less than or equal_ to this value (`50` acts the same as no limit)

metacritic

`(optional, integer)`

Minimum Metacritic rating for a game

steamRating

`(optional, integer)`

Minimum Steam reviews rating for a game

minimumReviewCount

`(optional, integer)`

Minimum number of Steam reviews for a game

maxAge

`(optional, integer)`

Filters to deals found within the specified number of hours (value between `1` and `2500`)

steamAppID

`(optional, string)`

Look for deals on specific games, comma separated list of Steam App ID (still bound by `pageSize`)

title

`(optional, string)`

Looks for the string contained anywhere in the game name

exact

`(optional, boolean)` Default `0`

Flag to allow only exact string match for `title` parameter

AAA

`(optional, boolean)` Default `0`

Flag to include only deals with retail price `> $29`

steamworks

`(optional, boolean)` Default `0`

Flag to include only deals that redeem on Steam (best guess, depends on store support)

onSale

`(optional, boolean)` Default `0`

Flag to include only games that are currently on sale

output

`(optional, string)`

Option to output deals in `RSS` format (overrides page number/size to `0/100`)

Example Request

List of Deals

curl

```rust
curl --location 'https://www.cheapshark.com/api/1.0/deals?storeID=1&upperPrice=15'
```

200 OK

Example Response

json

```perl
[
  {
    "internalName": "DEUSEXHUMANREVOLUTIONDIRECTORSCUT",
    "title": "Deus Ex: Human Revolution - Director's Cut",
    "metacriticLink": "/game/pc/deus-ex-human-revolution---directors-cut",
    "dealID": "HhzMJAgQYGZ%2B%2BFPpBG%2BRFcuUQZJO3KXvlnyYYGwGUfU%3D",
    "storeID": "1",
    "gameID": "102249",
    "salePrice": "2.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "85.042521",
    "metacriticScore": "91",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "92",
    "steamRatingCount": "17993",
    "steamAppID": "238010",
    "releaseDate": 1382400000,
    "lastChange": 1621536418,
    "dealRating": "9.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/238010/capsule_sm_120.jpg?t=1619788192"
  },
  {
    "internalName": "THIEFDEADLYSHADOWS",
    "title": "Thief: Deadly Shadows",
    "metacriticLink": "/game/pc/thief-deadly-shadows",
    "dealID": "EX0oH20b7A1H2YiVjvVx5A0HH%2F4etw3x%2F6YMGVPpKbA%3D",
    "storeID": "1",
    "gameID": "396",
    "salePrice": "0.98",
    "normalPrice": "8.99",
    "isOnSale": "1",
    "savings": "89.098999",
    "metacriticScore": "85",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "81",
    "steamRatingCount": "1670",
    "steamAppID": "6980",
    "releaseDate": 1085443200,
    "lastChange": 1621540561,
    "dealRating": "9.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/6980/capsule_sm_120.jpg?t=1592493801"
  },
  {
    "internalName": "JUSTCAUSE2",
    "title": "Just Cause 2",
    "metacriticLink": "/game/pc/just-cause-2",
    "dealID": "z4El8C19yCEHrk1%2ByEedebThQVbblI7H0Z%2BAmxgZiS8%3D",
    "storeID": "1",
    "gameID": "180",
    "salePrice": "1.49",
    "normalPrice": "14.99",
    "isOnSale": "1",
    "savings": "90.060040",
    "metacriticScore": "84",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "90",
    "steamRatingCount": "35296",
    "steamAppID": "8190",
    "releaseDate": 1269302400,
    "lastChange": 1621536477,
    "dealRating": "9.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/8190/capsule_sm_120.jpg?t=1593180404"
  },
  {
    "internalName": "THIEFIITHEMETALAGE",
    "title": "Thief II: The Metal Age",
    "metacriticLink": "/game/pc/thief-ii-the-metal-age",
    "dealID": "TlzUCY9p3Sq1bY%2Br4aGWO5Cs2UxE1lYnuQD05gxNwIM%3D",
    "storeID": "1",
    "gameID": "87640",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "87",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "93",
    "steamRatingCount": "1189",
    "steamAppID": "211740",
    "releaseDate": 953769600,
    "lastChange": 1621540630,
    "dealRating": "9.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/211740/capsule_sm_120.jpg?t=1592493747"
  },
  {
    "internalName": "DUNGEONSIEGE",
    "title": "Dungeon Siege",
    "metacriticLink": "/game/pc/dungeon-siege",
    "dealID": "Hli8KbDatTjYjj%2BjpnfUuVKjxPwQPmblW1llCXyMMmU%3D",
    "storeID": "1",
    "gameID": "192",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "86",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "78",
    "steamRatingCount": "2394",
    "steamAppID": "39190",
    "releaseDate": 1017532800,
    "lastChange": 1621540893,
    "dealRating": "9.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/39190/capsule_sm_120.jpg?t=1592491243"
  },
  {
    "internalName": "TOMBRAIDERANNIVERSARY",
    "title": "Tomb Raider: Anniversary",
    "metacriticLink": "/game/pc/tomb-raider-anniversary",
    "dealID": "ryaV37fbWkAIG6ZLy%2FtViuEGOIShgUVV7kpgbYlDqQk%3D",
    "storeID": "1",
    "gameID": "456",
    "salePrice": "0.98",
    "normalPrice": "8.99",
    "isOnSale": "1",
    "savings": "89.098999",
    "metacriticScore": "83",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "82",
    "steamRatingCount": "3621",
    "steamAppID": "8000",
    "releaseDate": 1181001600,
    "lastChange": 1621540355,
    "dealRating": "9.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/8000/capsule_sm_120.jpg?t=1592494287"
  },
  {
    "internalName": "TOMBRAIDER",
    "title": "Tomb Raider",
    "metacriticLink": "/game/pc/tomb-raider",
    "dealID": "kWwtV4oy9hfOjwLK521is0GJsspEXRq8K6pQKH6xvI0%3D",
    "storeID": "1",
    "gameID": "87392",
    "salePrice": "2.24",
    "normalPrice": "14.99",
    "isOnSale": "1",
    "savings": "85.056704",
    "metacriticScore": "86",
    "steamRatingText": "Overwhelmingly Positive",
    "steamRatingPercent": "96",
    "steamRatingCount": "113310",
    "steamAppID": "203160",
    "releaseDate": 1362355200,
    "lastChange": 1621536141,
    "dealRating": "9.2",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/203160/capsule_sm_120.jpg?t=1617888669"
  },
  {
    "internalName": "F12020",
    "title": "F1 2020",
    "metacriticLink": "/game/pc/f1-2020",
    "dealID": "l0PK4iJqTcB%2FhSle7RF7n7NGkOhHslBSff8Umv%2BzSeY%3D",
    "storeID": "1",
    "gameID": "213774",
    "salePrice": "14.99",
    "normalPrice": "59.99",
    "isOnSale": "1",
    "savings": "75.012502",
    "metacriticScore": "88",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "93",
    "steamRatingCount": "28641",
    "steamAppID": "1080110",
    "releaseDate": 1594252800,
    "lastChange": 1621535931,
    "dealRating": "9.1",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1080110/capsule_sm_120.jpg?t=1621526432"
  },
  {
    "internalName": "TOMBRAIDERUNDERWORLD",
    "title": "Tomb Raider: Underworld",
    "metacriticLink": "/game/pc/tomb-raider-underworld",
    "dealID": "XhdaphoqPFV2dl6MtPYcKItazwVt9ldkx4ybvnmPfZ0%3D",
    "storeID": "1",
    "gameID": "643",
    "salePrice": "0.98",
    "normalPrice": "8.99",
    "isOnSale": "1",
    "savings": "89.098999",
    "metacriticScore": "80",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "76",
    "steamRatingCount": "3549",
    "steamAppID": "8140",
    "releaseDate": 1226966400,
    "lastChange": 1621540596,
    "dealRating": "9.1",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/8140/capsule_sm_120.jpg?t=1592494880"
  },
  {
    "internalName": "CYBERNETICAFINAL",
    "title": "Cybernetica: Final",
    "metacriticLink": "/game/pc/cybernetica-final",
    "dealID": "YAm7vyXnmK5YWsFyTy22SFn5p%2F4Lrpu2eCCrrfvNO44%3D",
    "storeID": "1",
    "gameID": "226893",
    "salePrice": "1.89",
    "normalPrice": "18.99",
    "isOnSale": "1",
    "savings": "90.047393",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1549710",
    "releaseDate": 1614643200,
    "lastChange": 1621359373,
    "dealRating": "9.1",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1549710/capsule_sm_120.jpg?t=1614708882"
  },
  {
    "internalName": "THEWITCHER2ASSASSINSOFKINGSENHANCEDEDITION",
    "title": "The Witcher 2: Assassins of Kings Enhanced Edition",
    "metacriticLink": "/game/pc/the-witcher-2-assassins-of-kings",
    "dealID": "8JWQ51DVapSJnGVviMI0Hgu4YFqxme2sBdLD3vh6dZw%3D",
    "storeID": "1",
    "gameID": "5572",
    "salePrice": "2.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "85.042521",
    "metacriticScore": "88",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "90",
    "steamRatingCount": "57076",
    "steamAppID": "20920",
    "releaseDate": 1305590400,
    "lastChange": 1621366129,
    "dealRating": "9.0",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/20920/capsule_sm_120.jpg?t=1598536335"
  },
  {
    "internalName": "TOMBRAIDERLEGEND",
    "title": "Tomb Raider: Legend",
    "metacriticLink": "/game/pc/tomb-raider-legend",
    "dealID": "aM%2FwlRYvYES0Xzqw%2BxWNDihJpcSrvzKTx8jmQzisauQ%3D",
    "storeID": "1",
    "gameID": "502",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "82",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "88",
    "steamRatingCount": "2893",
    "steamAppID": "7000",
    "releaseDate": 1144713600,
    "lastChange": 1621540479,
    "dealRating": "9.0",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/7000/capsule_sm_120.jpg?t=1592494347"
  },
  {
    "internalName": "THEWITCHER3WILDHUNT",
    "title": "The Witcher 3: Wild Hunt",
    "metacriticLink": "/game/pc/the-witcher-3-wild-hunt",
    "dealID": "zm2ORJ1RIWrq7UFFCs9J4ps4rgsNUV7FTSnWxzxxj8Q%3D",
    "storeID": "1",
    "gameID": "112330",
    "salePrice": "7.99",
    "normalPrice": "39.99",
    "isOnSale": "1",
    "savings": "80.020005",
    "metacriticScore": "93",
    "steamRatingText": "Overwhelmingly Positive",
    "steamRatingPercent": "97",
    "steamRatingCount": "465499",
    "steamAppID": "292030",
    "releaseDate": 1431907200,
    "lastChange": 1621365983,
    "dealRating": "9.0",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/292030/capsule_sm_120.jpg?t=1607418742"
  },
  {
    "internalName": "QUANTUMCONUNDRUM",
    "title": "Quantum Conundrum",
    "metacriticLink": "/game/pc/quantum-conundrum",
    "dealID": "gqc27BiFr8jCzKle49%2BRbgB4sb7q2qXsRGkYztk2%2Bpg%3D",
    "storeID": "1",
    "gameID": "88139",
    "salePrice": "0.98",
    "normalPrice": "8.99",
    "isOnSale": "1",
    "savings": "89.098999",
    "metacriticScore": "77",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "84",
    "steamRatingCount": "1411",
    "steamAppID": "200010",
    "releaseDate": 1340236800,
    "lastChange": 1621541030,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/200010/capsule_sm_120.jpg?t=1576110892"
  },
  {
    "internalName": "THEWITCHERENHANCEDEDITIONDIRECTORSCUT",
    "title": "The Witcher: Enhanced Edition Director's Cut",
    "metacriticLink": "/game/pc/the-witcher-enhanced-edition",
    "dealID": "XvdAVEU9b7gYQqsNjJB6TCQtxN8qpubzIpJWMLvEVsQ%3D",
    "storeID": "1",
    "gameID": "188",
    "salePrice": "1.49",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "85.085085",
    "metacriticScore": "86",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "88",
    "steamRatingCount": "53428",
    "steamAppID": "20900",
    "releaseDate": 1221523200,
    "lastChange": 1621366237,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/20900/capsule_sm_120.jpg?t=1602591705"
  },
  {
    "internalName": "LARACROFTANDTHEGUARDIANOFLIGHT",
    "title": "Lara Croft and the Guardian of Light",
    "metacriticLink": "/game/pc/lara-croft-and-the-guardian-of-light",
    "dealID": "T51u9WVOmHHnOMf5%2B5rneO0MopDsUPrUa5nrFVFAoMM%3D",
    "storeID": "1",
    "gameID": "362",
    "salePrice": "1.49",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "85.085085",
    "metacriticScore": "82",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "91",
    "steamRatingCount": "2677",
    "steamAppID": "35130",
    "releaseDate": 1285632000,
    "lastChange": 1621536540,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/35130/capsule_sm_120.jpg?t=1616009927"
  },
  {
    "internalName": "DARKSPOT",
    "title": "Dark spot",
    "metacriticLink": "/game/pc/dark-spot",
    "dealID": "LsTgvw51bI4FcKrlOjUzuQPQnhjwr5R75taWx%2FYawHE%3D",
    "storeID": "1",
    "gameID": "225284",
    "salePrice": "1.89",
    "normalPrice": "18.99",
    "isOnSale": "1",
    "savings": "90.047393",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1511620",
    "releaseDate": 1611100800,
    "lastChange": 1621360488,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1511620/capsule_sm_120.jpg?t=1611158960"
  },
  {
    "internalName": "VECTORRACE",
    "title": "Vector Race",
    "metacriticLink": "/game/pc/vector-race",
    "dealID": "etdv1Ih%2FZDL9fjxvuPpLnlQNRZn397CZqO%2FhEE3Juz8%3D",
    "storeID": "1",
    "gameID": "225287",
    "salePrice": "1.89",
    "normalPrice": "18.99",
    "isOnSale": "1",
    "savings": "90.047393",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1511250",
    "releaseDate": 1611100800,
    "lastChange": 1621359778,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1511250/capsule_sm_120.jpg?t=1611158911"
  },
  {
    "internalName": "DEUSEXINVISIBLEWAR",
    "title": "Deus Ex: Invisible War",
    "metacriticLink": "/game/pc/deus-ex-invisible-war",
    "dealID": "ud3%2B6C779GBiodfzckSgNCsSfdahl4XAurSJXT0aNyM%3D",
    "storeID": "1",
    "gameID": "569",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "80",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "57",
    "steamRatingCount": "1386",
    "steamAppID": "6920",
    "releaseDate": 1070323200,
    "lastChange": 1621540954,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/6920/capsule_sm_120.jpg?t=1593593178"
  },
  {
    "internalName": "DUNGEONSIEGEII",
    "title": "Dungeon Siege II",
    "metacriticLink": "/game/pc/dungeon-siege-ii",
    "dealID": "yump1xHYf6GNwK9HJJSKDUPFFSFDetGTtptGxualJZ4%3D",
    "storeID": "1",
    "gameID": "305",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "80",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "71",
    "steamRatingCount": "1617",
    "steamAppID": "39200",
    "releaseDate": 1124150400,
    "lastChange": 1621540944,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/39200/capsule_sm_120.jpg?t=1592491309"
  },
  {
    "internalName": "MACROGOLF",
    "title": "Macro golf",
    "metacriticLink": "/game/pc/macro-golf",
    "dealID": "9Pqb7mrsh5lL5QRtvabuNx9r1lY23HI3Z1ZO5QVRh5c%3D",
    "storeID": "1",
    "gameID": "224117",
    "salePrice": "1.89",
    "normalPrice": "18.99",
    "isOnSale": "1",
    "savings": "90.047393",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1472260",
    "releaseDate": 1607904000,
    "lastChange": 1621416869,
    "dealRating": "8.9",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1472260/capsule_sm_120.jpg?t=1607935627"
  },
  {
    "internalName": "SLEEPINGDOGS",
    "title": "Sleeping Dogs",
    "metacriticLink": "/game/pc/sleeping-dogs",
    "dealID": "Q43%2FC3udAPUI8e41Xl%2FLlOBFFbhCb8GU2f3zrEy252A%3D",
    "storeID": "1",
    "gameID": "225921",
    "salePrice": "2.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "85.042521",
    "metacriticScore": "80",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "93",
    "steamRatingCount": "9702",
    "steamAppID": "202170",
    "releaseDate": 1344816000,
    "lastChange": 1621558374,
    "dealRating": "8.8",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/202170/capsule_sm_120.jpg?t=1592493319"
  },
  {
    "internalName": "DEUSEXMANKINDDIVIDED",
    "title": "Deus Ex: Mankind Divided",
    "metacriticLink": "/game/pc/deus-ex-mankind-divided",
    "dealID": "Ppi1hduzzSTTcVfyap53KkMwyHbwS8In80ZKCDLt3I4%3D",
    "storeID": "1",
    "gameID": "143165",
    "salePrice": "4.49",
    "normalPrice": "29.99",
    "isOnSale": "1",
    "savings": "85.028343",
    "metacriticScore": "83",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "74",
    "steamRatingCount": "23598",
    "steamAppID": "337000",
    "releaseDate": 1471910400,
    "lastChange": 1621536170,
    "dealRating": "8.8",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/337000/capsule_sm_120.jpg?t=1593165236"
  },
  {
    "internalName": "THEALMOSTGONE",
    "title": "The Almost Gone",
    "metacriticLink": "/game/pc/the-almost-gone",
    "dealID": "EiV9hijg%2FXBBwgGhkFVe7h39p2IPIp6SnQzTlBis5Ho%3D",
    "storeID": "1",
    "gameID": "217485",
    "salePrice": "1.99",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "80.080080",
    "metacriticScore": "67",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "86",
    "steamRatingCount": "249",
    "steamAppID": "1115780",
    "releaseDate": 1593043200,
    "lastChange": 1621519989,
    "dealRating": "8.8",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1115780/capsule_sm_120.jpg?t=1612815026"
  },
  {
    "internalName": "SUPREMECOMMANDER",
    "title": "Supreme Commander",
    "metacriticLink": "/game/pc/supreme-commander",
    "dealID": "PiIIJF7zgluX9sg6FU3E%2FiWkuyRxcPENcN4YIusyWOU%3D",
    "storeID": "1",
    "gameID": "102",
    "salePrice": "2.59",
    "normalPrice": "12.99",
    "isOnSale": "1",
    "savings": "80.061586",
    "metacriticScore": "86",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "88",
    "steamRatingCount": "1351",
    "steamAppID": "9350",
    "releaseDate": 1171929600,
    "lastChange": 1621536482,
    "dealRating": "8.8",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/9350/capsule_sm_120.jpg?t=1592493393"
  },
  {
    "internalName": "THENIGHTOFTHERABBIT",
    "title": "The Night of the Rabbit",
    "metacriticLink": "/game/pc/the-night-of-the-rabbit",
    "dealID": "o9Rx7JRHuFZuU59Iias%2BcEDCPAdM94bFsX1flJqGg58%3D",
    "storeID": "1",
    "gameID": "97671",
    "salePrice": "3.99",
    "normalPrice": "39.99",
    "isOnSale": "1",
    "savings": "90.022506",
    "metacriticScore": "75",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "90",
    "steamRatingCount": "1985",
    "steamAppID": "230820",
    "releaseDate": 1369699200,
    "lastChange": 1621520624,
    "dealRating": "8.8",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/230820/capsule_sm_120.jpg?t=1578499642"
  },
  {
    "internalName": "LEGACYOFKAINSOULREAVER2",
    "title": "Legacy of Kain: Soul Reaver 2",
    "metacriticLink": "/game/pc/legacy-of-kain-soul-reaver-2",
    "dealID": "j8q7crc53WZzX7SoT8YthpLrwgYk4te6WrUJ9Vp3vas%3D",
    "storeID": "1",
    "gameID": "88292",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "77",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "68",
    "steamRatingCount": "548",
    "steamAppID": "224940",
    "releaseDate": 1006214400,
    "lastChange": 1621541187,
    "dealRating": "8.7",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/224940/capsule_sm_120.jpg?t=1592492360"
  },
  {
    "internalName": "ANACHRONOX",
    "title": "Anachronox",
    "metacriticLink": "/game/pc/anachronox",
    "dealID": "Wm5ixfZbwwOipKl68nV285QtdWkimjwiWHWNqNGFdsA%3D",
    "storeID": "1",
    "gameID": "87210",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "77",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "75",
    "steamRatingCount": "268",
    "steamAppID": "242940",
    "releaseDate": 993600000,
    "lastChange": 1621541702,
    "dealRating": "8.7",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/242940/capsule_sm_120.jpg?t=1592490066"
  },
  {
    "internalName": "BATTLESTATIONSMIDWAY",
    "title": "Battlestations: Midway",
    "metacriticLink": "/game/pc/battlestations-midway",
    "dealID": "sUJsVIOun4HDA5vNHXYuz3ZnDXFoksRDD1TgYUWYnvQ%3D",
    "storeID": "1",
    "gameID": "757",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "76",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "75",
    "steamRatingCount": "576",
    "steamAppID": "6870",
    "releaseDate": 1170115200,
    "lastChange": 1621541102,
    "dealRating": "8.7",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/6870/capsule_sm_120.jpg?t=1592490116"
  },
  {
    "internalName": "HOLYPOTATOESAWEAPONSHOP",
    "title": "Holy Potatoes! A Weapon Shop?!",
    "metacriticLink": "/game/pc/holy-potatoes!-a-weapon-shop!",
    "dealID": "8Qubu0dkEUuvUGaDYbxXIgPXpf1E7CVy6IIzQTsvlfI%3D",
    "storeID": "1",
    "gameID": "144875",
    "salePrice": "0.99",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "90.090090",
    "metacriticScore": "69",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "72",
    "steamRatingCount": "968",
    "steamAppID": "363600",
    "releaseDate": 1436745600,
    "lastChange": 1621540980,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/363600/capsule_sm_120.jpg?t=1569148228"
  },
  {
    "internalName": "THEGIRLOFGLASSASUMMERBIRDSTALE",
    "title": "The Girl of Glass: A Summer Birds Tale",
    "metacriticLink": "/game/pc/the-girl-of-glass-a-summer-birds-tale",
    "dealID": "CK4BpMMyf%2BfFEnJgINJ2Lyqg0%2BMEc4HiNfhYR1FCei4%3D",
    "storeID": "1",
    "gameID": "220753",
    "salePrice": "3.74",
    "normalPrice": "14.99",
    "isOnSale": "1",
    "savings": "75.050033",
    "metacriticScore": "74",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "79",
    "steamRatingCount": "29",
    "steamAppID": "1203750",
    "releaseDate": 1600732800,
    "lastChange": 1621282236,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1203750/capsule_sm_120.jpg?t=1603631875"
  },
  {
    "internalName": "DOORKICKERS",
    "title": "Door Kickers",
    "metacriticLink": "/game/pc/door-kickers",
    "dealID": "Ag5ntcKmi1Iih%2FgiSbn45z%2BBdchiBCri6L82VjGeFU8%3D",
    "storeID": "1",
    "gameID": "101459",
    "salePrice": "3.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "80.040020",
    "metacriticScore": "83",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "94",
    "steamRatingCount": "6858",
    "steamAppID": "248610",
    "releaseDate": 1413763200,
    "lastChange": 1621637137,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/248610/capsule_sm_120.jpg?t=1611394211"
  },
  {
    "internalName": "RISEOFTHETOMBRAIDER",
    "title": "Rise of the Tomb Raider",
    "metacriticLink": "/game/pc/rise-of-the-tomb-raider",
    "dealID": "JLFqGNvtew3enSlgxRtAZBJ3GeU4Rd0XYhGePiQcaI8%3D",
    "storeID": "1",
    "gameID": "145517",
    "salePrice": "5.99",
    "normalPrice": "29.99",
    "isOnSale": "1",
    "savings": "80.026676",
    "metacriticScore": "86",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "93",
    "steamRatingCount": "76587",
    "steamAppID": "391220",
    "releaseDate": 1453939200,
    "lastChange": 1621536032,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/391220/capsule_sm_120.jpg?t=1617888747"
  },
  {
    "internalName": "EUROPAUNIVERSALISIV",
    "title": "Europa Universalis IV",
    "metacriticLink": "/game/pc/europa-universalis-iv",
    "dealID": "vL71CK2%2FNgPmTBqXjYF5%2FVAHB6DCrQlEfO3HmfpDjQU%3D",
    "storeID": "1",
    "gameID": "98151",
    "salePrice": "7.99",
    "normalPrice": "39.99",
    "isOnSale": "1",
    "savings": "80.020005",
    "metacriticScore": "87",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "85",
    "steamRatingCount": "63937",
    "steamAppID": "236850",
    "releaseDate": 1376352000,
    "lastChange": 1621535903,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/236850/capsule_sm_120.jpg?t=1621601455"
  },
  {
    "internalName": "JUSTCAUSE",
    "title": "Just Cause",
    "metacriticLink": "/game/pc/just-cause",
    "dealID": "wefWa0f%2FDzhCeF5vT2iNlMdiO3XVMXtuRbr49HWF9wk%3D",
    "storeID": "1",
    "gameID": "1368",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "75",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "66",
    "steamRatingCount": "3049",
    "steamAppID": "6880",
    "releaseDate": 1159315200,
    "lastChange": 1621541171,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/6880/capsule_sm_120.jpg?t=1593180235"
  },
  {
    "internalName": "PROJECTSNOWBLIND",
    "title": "Project: Snowblind",
    "metacriticLink": "/game/pc/project-snowblind",
    "dealID": "JfRgVz7xYBAPYR3rU%2F2nN5gYeX%2Fv%2BdsGRPDkltIxvSE%3D",
    "storeID": "1",
    "gameID": "1197",
    "salePrice": "0.89",
    "normalPrice": "5.99",
    "isOnSale": "1",
    "savings": "85.141903",
    "metacriticScore": "76",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "73",
    "steamRatingCount": "396",
    "steamAppID": "7010",
    "releaseDate": 1110844800,
    "lastChange": 1621542001,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/7010/capsule_sm_120.jpg?t=1592493169"
  },
  {
    "internalName": "CYBERNETICAFALLENCITY",
    "title": "Cybernetica: fallen city",
    "metacriticLink": "/game/pc/cybernetica-fallen-city",
    "dealID": "WkSGEGRH70uyeAJGnCS46WORlJG%2FIqOWWhCLdp%2Fa9iM%3D",
    "storeID": "1",
    "gameID": "221372",
    "salePrice": "1.89",
    "normalPrice": "18.99",
    "isOnSale": "1",
    "savings": "90.047393",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1432930",
    "releaseDate": 1602460800,
    "lastChange": 1621448489,
    "dealRating": "8.6",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1432930/capsule_sm_120.jpg?t=1602564604"
  },
  {
    "internalName": "CITIESSKYLINES",
    "title": "Cities: Skylines",
    "metacriticLink": "/game/pc/cities-skylines",
    "dealID": "TfTep583ZMI472sk%2BOo9w%2F%2BpETwB7QmLkuMKV4WORMQ%3D",
    "storeID": "1",
    "gameID": "141534",
    "salePrice": "5.99",
    "normalPrice": "29.99",
    "isOnSale": "1",
    "savings": "80.026676",
    "metacriticScore": "85",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "93",
    "steamRatingCount": "159996",
    "steamAppID": "255710",
    "releaseDate": 1425945600,
    "lastChange": 1621535891,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/255710/capsule_sm_120_alt_assets_0.jpg?t=1621621159"
  },
  {
    "internalName": "KANEANDLYNCH2DOGDAYS",
    "title": "Kane and Lynch 2: Dog Days",
    "metacriticLink": "/game/pc/kane-lynch-2-dog-days",
    "dealID": "J4NjFfnzKO5P3TLf3ZjQrE73e10JObKHstDkTn5TEpc%3D",
    "storeID": "1",
    "gameID": "3992",
    "salePrice": "0.99",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "90.090090",
    "metacriticScore": "66",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "61",
    "steamRatingCount": "4419",
    "steamAppID": "28000",
    "releaseDate": 1282003200,
    "lastChange": 1621540987,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/28000/capsule_sm_120.jpg?t=1592492023"
  },
  {
    "internalName": "HOLYPOTATOESWEREINSPACE",
    "title": "Holy Potatoes! Were in Space?!",
    "metacriticLink": "/game/pc/holy-potatoes!-were-in-space!",
    "dealID": "e2oPVjhhY9cEvvCDVSRT7a3rVhE2fTBCDp39gl0l9Tk%3D",
    "storeID": "1",
    "gameID": "165716",
    "salePrice": "0.99",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "90.090090",
    "metacriticScore": "66",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "72",
    "steamRatingCount": "371",
    "steamAppID": "505730",
    "releaseDate": 1487030400,
    "lastChange": 1621520737,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/505730/capsule_sm_120.jpg?t=1569143225"
  },
  {
    "internalName": "AGEOFWONDERSSHADOWMAGIC",
    "title": "Age of Wonders Shadow Magic",
    "metacriticLink": "/game/pc/age-of-wonders-shadow-magic",
    "dealID": "YhNhR4gcCDHTAyVGnWD1fuHoPAQrOApCnMh1gyPoInc%3D",
    "storeID": "1",
    "gameID": "391",
    "salePrice": "1.99",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "80.080080",
    "metacriticScore": "82",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "90",
    "steamRatingCount": "351",
    "steamAppID": "61520",
    "releaseDate": 1059091200,
    "lastChange": 1621541719,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/61520/capsule_sm_120.jpg?t=1504268411"
  },
  {
    "internalName": "SAINTSROWIV",
    "title": "Saints Row IV",
    "metacriticLink": "/game/pc/saints-row-iv",
    "dealID": "P%2FV0aU8xwK1BFytpsx73GZKUvO2oGXBh6m4m%2FLfECFs%3D",
    "storeID": "1",
    "gameID": "98304",
    "salePrice": "3.74",
    "normalPrice": "14.99",
    "isOnSale": "1",
    "savings": "75.050033",
    "metacriticScore": "86",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "90",
    "steamRatingCount": "51023",
    "steamAppID": "206420",
    "releaseDate": 1376870400,
    "lastChange": 1621637036,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/206420/capsule_sm_120.jpg?t=1620658883"
  },
  {
    "internalName": "ALLOTROPY",
    "title": "Allotropy",
    "metacriticLink": "/game/pc/allotropy",
    "dealID": "1XfGfY%2FSdRmhMe69WDLGhFnJnMhZMt5cuPxKd6N2zbo%3D",
    "storeID": "1",
    "gameID": "222246",
    "salePrice": "1.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "90.045023",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1450530",
    "releaseDate": 1603929600,
    "lastChange": 1621360549,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1450530/capsule_sm_120.jpg?t=1603963408"
  },
  {
    "internalName": "MINININJAS",
    "title": "Mini Ninjas",
    "metacriticLink": "/game/pc/mini-ninjas",
    "dealID": "F4iSlLjwMCr0OcdjIGIHErdjlQDvjAWoOIkI7DXTXD8%3D",
    "storeID": "1",
    "gameID": "1140",
    "salePrice": "1.49",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "85.085085",
    "metacriticScore": "74",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "89",
    "steamRatingCount": "2284",
    "steamAppID": "35000",
    "releaseDate": 1252368000,
    "lastChange": 1621540469,
    "dealRating": "8.5",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/35000/capsule_sm_120.jpg?t=1592492627"
  },
  {
    "internalName": "SHADOWRUNDRAGONFALLDIRECTORSCUT",
    "title": "Shadowrun: Dragonfall - Director's Cut",
    "metacriticLink": "/game/pc/shadowrun-dragonfall---directors-cut",
    "dealID": "3h8Q9xkKseH4c9gtYRBnRVW1CHg7SX2uXyE2gwHSZ78%3D",
    "storeID": "1",
    "gameID": "128800",
    "salePrice": "3.74",
    "normalPrice": "14.99",
    "isOnSale": "1",
    "savings": "75.050033",
    "metacriticScore": "87",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "89",
    "steamRatingCount": "4253",
    "steamAppID": "300550",
    "releaseDate": 1410998400,
    "lastChange": 1621536508,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/300550/capsule_sm_120.jpg?t=1615974138"
  },
  {
    "internalName": "CYBERCUBEBATTLE",
    "title": "Cybercube battle",
    "metacriticLink": "/game/pc/cybercube-battle",
    "dealID": "UC2%2B7pGYFjhTRIc4xYJ%2Fcc8onUeN1uZ7lQ%2Fn1bPAZOA%3D",
    "storeID": "1",
    "gameID": "221551",
    "salePrice": "1.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "90.045023",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1431620",
    "releaseDate": 1602806400,
    "lastChange": 1621362504,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1431620/capsule_sm_120.jpg?t=1602834314"
  },
  {
    "internalName": "CRYPTOFTHENECRODANCER",
    "title": "Crypt of the NecroDancer",
    "metacriticLink": "/game/pc/crypt-of-the-necrodancer",
    "dealID": "5Aiw0UGtePMGhVWUzvhkvd8VLBIn9OJEJ3%2BD4SSwr0k%3D",
    "storeID": "1",
    "gameID": "119755",
    "salePrice": "2.99",
    "normalPrice": "14.99",
    "isOnSale": "1",
    "savings": "80.053369",
    "metacriticScore": "87",
    "steamRatingText": "Overwhelmingly Positive",
    "steamRatingPercent": "96",
    "steamRatingCount": "17733",
    "steamAppID": "247080",
    "releaseDate": 1429747200,
    "lastChange": 1621280458,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/247080/capsule_sm_120.jpg?t=1621545126"
  },
  {
    "internalName": "AGEOFWONDERSIITHEWIZARDSTHRONE",
    "title": "Age of Wonders II: The Wizard's Throne",
    "metacriticLink": "/game/pc/age-of-wonders-ii-the-wizards-throne",
    "dealID": "iYmdvrNE1WGflZ%2Bsy8UMA9h0mj%2BIa%2Bx4PUfycUf6eW8%3D",
    "storeID": "1",
    "gameID": "281",
    "salePrice": "2.49",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "75.075075",
    "metacriticScore": "86",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "82",
    "steamRatingCount": "169",
    "steamAppID": "61510",
    "releaseDate": 1023840000,
    "lastChange": 1621541699,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/61510/capsule_sm_120.jpg?t=1589900679"
  },
  {
    "internalName": "SUPREMECOMMANDERFORGEDALLIANCE",
    "title": "Supreme Commander: Forged Alliance",
    "metacriticLink": "/game/pc/supreme-commander-forged-alliance",
    "dealID": "oF8uCwjMqAyxhFpIWY%2Ff%2B2Z1hb2hHdMoUM6jLBrRH7o%3D",
    "storeID": "1",
    "gameID": "141",
    "salePrice": "2.59",
    "normalPrice": "12.99",
    "isOnSale": "1",
    "savings": "80.061586",
    "metacriticScore": "81",
    "steamRatingText": "Overwhelmingly Positive",
    "steamRatingPercent": "96",
    "steamRatingCount": "5969",
    "steamAppID": "9420",
    "releaseDate": 1194307200,
    "lastChange": 1621536363,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/9420/capsule_sm_120.jpg?t=1592488757"
  },
  {
    "internalName": "SAINTSROWTHETHIRD",
    "title": "Saints Row: The Third",
    "metacriticLink": "/game/pc/saints-row-the-third",
    "dealID": "IFN5NbpTgE5uvtlaFQHHJXSY9EfIxhs8H2pMcw8Oli0%3D",
    "storeID": "1",
    "gameID": "19",
    "salePrice": "2.49",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "75.075075",
    "metacriticScore": "84",
    "steamRatingText": "Overwhelmingly Positive",
    "steamRatingPercent": "96",
    "steamRatingCount": "41953",
    "steamAppID": "55230",
    "releaseDate": 1321228800,
    "lastChange": 1621637049,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/55230/capsule_sm_120.jpg?t=1620658766"
  },
  {
    "internalName": "JUSTCAUSE3",
    "title": "Just Cause 3",
    "metacriticLink": "/game/pc/just-cause-3",
    "dealID": "l1AMpNpIOvx2XyCI%2BMosGbz5da3QsuSNGcYENFXOmx4%3D",
    "storeID": "1",
    "gameID": "137357",
    "salePrice": "2.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "85.042521",
    "metacriticScore": "74",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "81",
    "steamRatingCount": "67830",
    "steamAppID": "225540",
    "releaseDate": 1448841600,
    "lastChange": 1621536075,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/225540/capsule_sm_120.jpg?t=1612807713"
  },
  {
    "internalName": "LEGACYOFKAINDEFIANCE",
    "title": "Legacy of Kain: Defiance",
    "metacriticLink": "/game/pc/legacy-of-kain-defiance",
    "dealID": "ujh2lwyxA7S4C2qu%2BomOsKCuubBVIIBqdal%2FNxZEa98%3D",
    "storeID": "1",
    "gameID": "88868",
    "salePrice": "0.97",
    "normalPrice": "6.99",
    "isOnSale": "1",
    "savings": "86.123033",
    "metacriticScore": "70",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "86",
    "steamRatingCount": "638",
    "steamAppID": "224300",
    "releaseDate": 1071619200,
    "lastChange": 1621540893,
    "dealRating": "8.4",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/224300/capsule_sm_120.jpg?t=1592492274"
  },
  {
    "internalName": "LARACROFTANDTHETEMPLEOFOSIRIS",
    "title": "Lara Croft and the Temple of Osiris",
    "metacriticLink": "/game/pc/lara-croft-and-the-temple-of-osiris",
    "dealID": "CEjewbldwM8WWItN4nHw7se13GDRXBtnaWQNgoMu%2FmE%3D",
    "storeID": "1",
    "gameID": "112359",
    "salePrice": "2.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "85.042521",
    "metacriticScore": "73",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "64",
    "steamRatingCount": "924",
    "steamAppID": "289690",
    "releaseDate": 1417996800,
    "lastChange": 1621536499,
    "dealRating": "8.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/289690/capsule_sm_120.jpg?t=1616009802"
  },
  {
    "internalName": "KELVINANDTHEINFAMOUSMACHINE",
    "title": "Kelvin and the Infamous Machine",
    "metacriticLink": "/game/pc/kelvin-and-the-infamous-machine",
    "dealID": "GFC9%2F%2FiEoj6Pis0DZ5wo4MP9N2eVstrp6iHGPRsiTpk%3D",
    "storeID": "1",
    "gameID": "150791",
    "salePrice": "1.49",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "85.085085",
    "metacriticScore": "79",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "89",
    "steamRatingCount": "609",
    "steamAppID": "376520",
    "releaseDate": 1469059200,
    "lastChange": 1621282054,
    "dealRating": "8.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/376520/capsule_sm_120.jpg?t=1586284366"
  },
  {
    "internalName": "MURDEREDSOULSUSPECT",
    "title": "Murdered: Soul Suspect",
    "metacriticLink": "/game/pc/murdered-soul-suspect",
    "dealID": "JOWU6CyVCp9aSCXx81oxKbvOK0I%2FwnVsj%2FQCHrnGzrc%3D",
    "storeID": "1",
    "gameID": "95943",
    "salePrice": "1.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "90.045023",
    "metacriticScore": "59",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "86",
    "steamRatingCount": "8758",
    "steamAppID": "233290",
    "releaseDate": 1401753600,
    "lastChange": 1621540735,
    "dealRating": "8.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/233290/capsule_sm_120.jpg?t=1503075903"
  },
  {
    "internalName": "CUBEMAN",
    "title": "Cube Man",
    "metacriticLink": "/game/pc/cube-man",
    "dealID": "cHfn4y0G%2BzGCzT47HODdfB7wvrcZbSQTuBTq1O7hU54%3D",
    "storeID": "1",
    "gameID": "219341",
    "salePrice": "1.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "90.045023",
    "metacriticScore": "0",
    "steamRatingText": null,
    "steamRatingPercent": "0",
    "steamRatingCount": "0",
    "steamAppID": "1019910",
    "releaseDate": 1597363200,
    "lastChange": 1621449322,
    "dealRating": "8.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/1019910/capsule_sm_120.jpg?t=1604530555"
  },
  {
    "internalName": "PLANARCONQUEST",
    "title": "Planar Conquest",
    "metacriticLink": "/game/pc/planar-conquest",
    "dealID": "aenQmFSWrJ4cuJPa54GJscB42hmhIk0p8gW5i3Qs7x8%3D",
    "storeID": "1",
    "gameID": "153168",
    "salePrice": "1.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "90.045023",
    "metacriticScore": "53",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "51",
    "steamRatingCount": "273",
    "steamAppID": "449300",
    "releaseDate": 1464566400,
    "lastChange": 1621559519,
    "dealRating": "8.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/449300/capsule_sm_120.jpg?t=1573155421"
  },
  {
    "internalName": "ORDEROFWAR",
    "title": "Order of War",
    "metacriticLink": "/game/pc/order-of-war",
    "dealID": "EbfZSSWInAx13eoImnccs8ocjGLEATE9K9lmTzy8R4E%3D",
    "storeID": "1",
    "gameID": "874",
    "salePrice": "1.19",
    "normalPrice": "7.99",
    "isOnSale": "1",
    "savings": "85.106383",
    "metacriticScore": "69",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "68",
    "steamRatingCount": "304",
    "steamAppID": "34600",
    "releaseDate": 1253577600,
    "lastChange": 1621542595,
    "dealRating": "8.3",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/34600/capsule_sm_120.jpg?t=1592493041"
  },
  {
    "internalName": "ALICEVR",
    "title": "ALICE VR",
    "metacriticLink": "/game/pc/alice-vr",
    "dealID": "tYZtBOSA2ppfqntLVnJ0LCI8yfwclJfKcBLUJ0QZW0c%3D",
    "storeID": "1",
    "gameID": "161113",
    "salePrice": "0.99",
    "normalPrice": "9.99",
    "isOnSale": "1",
    "savings": "90.090090",
    "metacriticScore": "55",
    "steamRatingText": "Mixed",
    "steamRatingPercent": "40",
    "steamRatingCount": "132",
    "steamAppID": "513320",
    "releaseDate": 1477526400,
    "lastChange": 1621542541,
    "dealRating": "8.2",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/513320/capsule_sm_120.jpg?t=1594211671"
  },
  {
    "internalName": "THIEF",
    "title": "Thief",
    "metacriticLink": "/game/pc/thief",
    "dealID": "K9OYz%2Fzeuv7oEsSmVicqubx0I6IgaGzObAGGoR6LRqw%3D",
    "storeID": "1",
    "gameID": "95945",
    "salePrice": "2.99",
    "normalPrice": "19.99",
    "isOnSale": "1",
    "savings": "85.042521",
    "metacriticScore": "70",
    "steamRatingText": "Mostly Positive",
    "steamRatingPercent": "73",
    "steamRatingCount": "13534",
    "steamAppID": "239160",
    "releaseDate": 1393286400,
    "lastChange": 1621536338,
    "dealRating": "8.2",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/239160/capsule_sm_120.jpg?t=1592493618"
  }
]
```

Date

Sun, 23 May 2021 14:10:27 GMT

Content-Type

application/json

Transfer-Encoding

chunked

Connection

keep-alive

CF-Ray

653ede20ba573dfd-EWR

Access-Control-Allow-Origin

\*

Cache-Control

max-age=300, s-maxage=600, stale-while-revalidate=30, stale-if-error=60, public

Vary

Accept-Encoding

CF-Cache-Status

MISS

Access-Control-Allow-Headers

\*

Access-Control-Allow-Methods

GET, HEAD, OPTIONS

cf-request-id

0a3b29287100003dfdc3049000000001

Expect-CT

max-age=604800, report-uri="https://report-uri.cloudflare.com/cdn-cgi/beacon/expect-ct"

PHP-Cache

MISS

X-Powered-By

The love of games, an addiction to deals, and a bit of code! :)

X-Total-Page-Count

558

Report-To

{"endpoints":\[{"url":"https:\\/\\/a.nel.cloudflare.com\\/report?s=6C6jlEHH%2F8eyPePKWn09SGPVWC%2FS0yfeRN1n5%2BcGUg58hAoZDkVTxGre9BLaeE%2FjSgrCIcOYXteIFcQW7E7Z9JkQVTNRQXuF7%2BZ22nfVCPcWHdA%3D"}\],"group":"cf-nel","max\_age":604800}

NEL

{"report\_to":"cf-nel","max\_age":604800}

Server

cloudflare

Content-Encoding

br

### GETDeal Lookup

https://www.cheapshark.com/api/1.0/deals?id=X8sebHhbc1Ga0dTkgg59WgyM506af9oNZZJLU9uSrX8%3D

Get info for a specific deal. Response includes game info, any cheaper current deals, and the cheapest historical price. As elsewhere, dealID is encoded

PARAMS

id

X8sebHhbc1Ga0dTkgg59WgyM506af9oNZZJLU9uSrX8%3D

`(required, string)`

An Encoded Deal ID

Example Request

Deal Lookup

curl

```rust
curl --location 'https://www.cheapshark.com/api/1.0/deals?id=X8sebHhbc1Ga0dTkgg59WgyM506af9oNZZJLU9uSrX8%253D'
```

200 OK

Example Response

json

```perl
{
  "gameInfo": {
    "storeID": "1",
    "gameID": "93503",
    "name": "BioShock Infinite",
    "steamAppID": "8870",
    "salePrice": "29.99",
    "retailPrice": "29.99",
    "steamRatingText": "Very Positive",
    "steamRatingPercent": "93",
    "steamRatingCount": "98477",
    "metacriticScore": "94",
    "metacriticLink": "/game/pc/bioshock-infinite",
    "releaseDate": 1364169600,
    "publisher": "N/A",
    "steamworks": "1",
    "thumb": "https://cdn.cloudflare.steamstatic.com/steam/apps/8870/capsule_sm_120.jpg?t=1602794480"
  },
  "cheaperStores": [
    {
      "dealID": "vb3EqB4KpKbSyV83DXQYAZCSBS60LaOMgLCXSt8pQxw%3D",
      "storeID": "23",
      "salePrice": "5.89",
      "retailPrice": "29.99"
    },
    {
      "dealID": "boC2N0Q7SMCKxv6UKjRw%2BLFY6%2BNLEeWM2Bf1i80clx0%3D",
      "storeID": "21",
      "salePrice": "5.99",
      "retailPrice": "29.99"
    },
    {
      "dealID": "tbqfs8HsmHWn0mMk2QRCPd7KWLidkHrIYZX3FbYCyk0%3D",
      "storeID": "30",
      "salePrice": "7.19",
      "retailPrice": "29.99"
    },
    {
      "dealID": "r%2FGHYdW6GKpZfaqR4DQrjKD7vBoWiFPP7npVpVw4350%3D",
      "storeID": "34",
      "salePrice": "7.20",
      "retailPrice": "29.99"
    },
    {
      "dealID": "OVrkWmI7sl5RN61pxpA44euybrH826w%2FjvlV%2BYKc2oA%3D",
      "storeID": "2",
      "salePrice": "7.49",
      "retailPrice": "29.99"
    },
    {
      "dealID": "5ptxhcM1fatjVrZSnNNpbSz6okheevZEhcBAZm4AUfU%3D",
      "storeID": "35",
      "salePrice": "7.50",
      "retailPrice": "29.99"
    },
    {
      "dealID": "DQ%2BYLI9do4mm0H2%2BDUd6npgoQoK8bseNvyjJe%2B%2F3dEo%3D",
      "storeID": "15",
      "salePrice": "26.28",
      "retailPrice": "29.99"
    },
    {
      "dealID": "kj2H%2FvwfkyU40jW9s2g88CAW4PuR0etKlYvkQLitgvQ%3D",
      "storeID": "29",
      "salePrice": "26.99",
      "retailPrice": "29.99"
    },
    {
      "dealID": "fq0cNHiR3Z4TpZyV7WH865C1%2BCBlmufYUc%2Bu2HqyUHE%3D",
      "storeID": "27",
      "salePrice": "26.99",
      "retailPrice": "29.99"
    }
  ],
  "cheapestPrice": {
    "price": "4.49",
    "date": 1682548425
  }
}
```

Date

Mon, 19 Jun 2023 17:29:08 GMT

Content-Type

application/json

Transfer-Encoding

chunked

Connection

keep-alive

CF-Ray

7d9d7e10a8c90609-IAD

CF-Cache-Status

EXPIRED

Access-Control-Allow-Origin

\*

Cache-Control

max-age=300, public

Last-Modified

Mon, 19 Jun 2023 16:57:22 GMT

Vary

Accept-Encoding

access-control-allow-headers

\*

access-control-allow-methods

GET, HEAD, OPTIONS

access-control-expose-headers

Content-Encoding, X-Total-Page-Count

cdn-cache-control

max-age=600, stale-while-revalidate=60, stale-if-error=432000, public

php-cache

EXPIRED

php-cache-age

0

php-cache-key

aae404cb474f2d477a63e317d23562f85ee18898

php-cache-max-age

300

x-powered-by

The love of games, an addiction to deals, and a bit of code! :)

Report-To

{"endpoints":\[{"url":"https:\\/\\/a.nel.cloudflare.com\\/report\\/v3?s=cJgNqKZXYSX5R%2BzyXGlqNwYtvburCiDhSCeluo9TfK%2BxsNduoIqUoOhKr51gcjwYn1aUwOIz89nMXuEiNapNSOkj5l2HGDLlP%2F96vr8lRrwI0gvjrM5ZqYQmOZGEAI59U49IoA%3D%3D"}\],"group":"cf-nel","max\_age":604800}

NEL

{"success\_fraction":0,"report\_to":"cf-nel","max\_age":604800}

Server

cloudflare

Content-Encoding

br

## 

🛒 Stores

## 

🛒 Stores

Information and logos for stores that we track.

### GETStores Info

https://www.cheapshark.com/api/1.0/stores

Returns a full list of store IDs, names, and a flag specifying if store is active.

Response also includes an collection of banner / logo / icon image URLs for each store.

📌 Note: These URLs are relative, and should be appended to the CheapShark domain, for example -

`https://www.cheapshark.com{path-to-image}`

Example Request

Stores Info

curl

```rust
curl --location 'https://www.cheapshark.com/api/1.0/stores'
```

200 OK

Example Response

json

```json
[
  {
    "storeID": "1",
    "storeName": "Steam",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/0.png",
      "logo": "/img/stores/logos/0.png",
      "icon": "/img/stores/icons/0.png"
    }
  },
  {
    "storeID": "2",
    "storeName": "GamersGate",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/1.png",
      "logo": "/img/stores/logos/1.png",
      "icon": "/img/stores/icons/1.png"
    }
  },
  {
    "storeID": "3",
    "storeName": "GreenManGaming",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/2.png",
      "logo": "/img/stores/logos/2.png",
      "icon": "/img/stores/icons/2.png"
    }
  },
  {
    "storeID": "4",
    "storeName": "Amazon",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/3.png",
      "logo": "/img/stores/logos/3.png",
      "icon": "/img/stores/icons/3.png"
    }
  },
  {
    "storeID": "5",
    "storeName": "GameStop",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/4.png",
      "logo": "/img/stores/logos/4.png",
      "icon": "/img/stores/icons/4.png"
    }
  },
  {
    "storeID": "6",
    "storeName": "Direct2Drive",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/5.png",
      "logo": "/img/stores/logos/5.png",
      "icon": "/img/stores/icons/5.png"
    }
  },
  {
    "storeID": "7",
    "storeName": "GOG",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/6.png",
      "logo": "/img/stores/logos/6.png",
      "icon": "/img/stores/icons/6.png"
    }
  },
  {
    "storeID": "8",
    "storeName": "Origin",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/7.png",
      "logo": "/img/stores/logos/7.png",
      "icon": "/img/stores/icons/7.png"
    }
  },
  {
    "storeID": "9",
    "storeName": "Get Games",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/8.png",
      "logo": "/img/stores/logos/8.png",
      "icon": "/img/stores/icons/8.png"
    }
  },
  {
    "storeID": "10",
    "storeName": "Shiny Loot",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/9.png",
      "logo": "/img/stores/logos/9.png",
      "icon": "/img/stores/icons/9.png"
    }
  },
  {
    "storeID": "11",
    "storeName": "Humble Store",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/10.png",
      "logo": "/img/stores/logos/10.png",
      "icon": "/img/stores/icons/10.png"
    }
  },
  {
    "storeID": "12",
    "storeName": "Desura",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/11.png",
      "logo": "/img/stores/logos/11.png",
      "icon": "/img/stores/icons/11.png"
    }
  },
  {
    "storeID": "13",
    "storeName": "Uplay",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/12.png",
      "logo": "/img/stores/logos/12.png",
      "icon": "/img/stores/icons/12.png"
    }
  },
  {
    "storeID": "14",
    "storeName": "IndieGameStand",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/13.png",
      "logo": "/img/stores/logos/13.png",
      "icon": "/img/stores/icons/13.png"
    }
  },
  {
    "storeID": "15",
    "storeName": "Fanatical",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/14.png",
      "logo": "/img/stores/logos/14.png",
      "icon": "/img/stores/icons/14.png"
    }
  },
  {
    "storeID": "16",
    "storeName": "Gamesrocket",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/15.png",
      "logo": "/img/stores/logos/15.png",
      "icon": "/img/stores/icons/15.png"
    }
  },
  {
    "storeID": "17",
    "storeName": "Games Republic",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/16.png",
      "logo": "/img/stores/logos/16.png",
      "icon": "/img/stores/icons/16.png"
    }
  },
  {
    "storeID": "18",
    "storeName": "SilaGames",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/17.png",
      "logo": "/img/stores/logos/17.png",
      "icon": "/img/stores/icons/17.png"
    }
  },
  {
    "storeID": "19",
    "storeName": "Playfield",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/18.png",
      "logo": "/img/stores/logos/18.png",
      "icon": "/img/stores/icons/18.png"
    }
  },
  {
    "storeID": "20",
    "storeName": "ImperialGames",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/19.png",
      "logo": "/img/stores/logos/19.png",
      "icon": "/img/stores/icons/19.png"
    }
  },
  {
    "storeID": "21",
    "storeName": "WinGameStore",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/20.png",
      "logo": "/img/stores/logos/20.png",
      "icon": "/img/stores/icons/20.png"
    }
  },
  {
    "storeID": "22",
    "storeName": "FunStockDigital",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/21.png",
      "logo": "/img/stores/logos/21.png",
      "icon": "/img/stores/icons/21.png"
    }
  },
  {
    "storeID": "23",
    "storeName": "GameBillet",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/22.png",
      "logo": "/img/stores/logos/22.png",
      "icon": "/img/stores/icons/22.png"
    }
  },
  {
    "storeID": "24",
    "storeName": "Voidu",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/23.png",
      "logo": "/img/stores/logos/23.png",
      "icon": "/img/stores/icons/23.png"
    }
  },
  {
    "storeID": "25",
    "storeName": "Epic Games Store",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/24.png",
      "logo": "/img/stores/logos/24.png",
      "icon": "/img/stores/icons/24.png"
    }
  },
  {
    "storeID": "26",
    "storeName": "Razer Game Store",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/25.png",
      "logo": "/img/stores/logos/25.png",
      "icon": "/img/stores/icons/25.png"
    }
  },
  {
    "storeID": "27",
    "storeName": "Gamesplanet",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/26.png",
      "logo": "/img/stores/logos/26.png",
      "icon": "/img/stores/icons/26.png"
    }
  },
  {
    "storeID": "28",
    "storeName": "Gamesload",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/27.png",
      "logo": "/img/stores/logos/27.png",
      "icon": "/img/stores/icons/27.png"
    }
  },
  {
    "storeID": "29",
    "storeName": "2Game",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/28.png",
      "logo": "/img/stores/logos/28.png",
      "icon": "/img/stores/icons/28.png"
    }
  },
  {
    "storeID": "30",
    "storeName": "IndieGala",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/29.png",
      "logo": "/img/stores/logos/29.png",
      "icon": "/img/stores/icons/29.png"
    }
  },
  {
    "storeID": "31",
    "storeName": "Blizzard Shop",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/30.png",
      "logo": "/img/stores/logos/30.png",
      "icon": "/img/stores/icons/30.png"
    }
  },
  {
    "storeID": "32",
    "storeName": "AllYouPlay",
    "isActive": 0,
    "images": {
      "banner": "/img/stores/banners/31.png",
      "logo": "/img/stores/logos/31.png",
      "icon": "/img/stores/icons/31.png"
    }
  },
  {
    "storeID": "33",
    "storeName": "DLGamer",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/32.png",
      "logo": "/img/stores/logos/32.png",
      "icon": "/img/stores/icons/32.png"
    }
  },
  {
    "storeID": "34",
    "storeName": "Noctre",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/33.png",
      "logo": "/img/stores/logos/33.png",
      "icon": "/img/stores/icons/33.png"
    }
  },
  {
    "storeID": "35",
    "storeName": "DreamGame",
    "isActive": 1,
    "images": {
      "banner": "/img/stores/banners/34.png",
      "logo": "/img/stores/logos/34.png",
      "icon": "/img/stores/icons/34.png"
    }
  }
]
```

Date

Mon, 19 Jun 2023 17:34:43 GMT

Content-Type

application/json

Transfer-Encoding

chunked

Connection

keep-alive

CF-Ray

7d9d863f081d0609-IAD

CF-Cache-Status

HIT

Access-Control-Allow-Origin

\*

Age

9

Cache-Control

max-age=300, public

Last-Modified

Mon, 19 Jun 2023 17:33:55 GMT

Vary

Accept-Encoding

access-control-allow-headers

\*

access-control-allow-methods

GET, HEAD, OPTIONS

access-control-expose-headers

Content-Encoding, X-Total-Page-Count

cdn-cache-control

max-age=600, stale-while-revalidate=60, stale-if-error=432000, public

php-cache

EXPIRED

php-cache-age

0

php-cache-key

dacb690e0119aefb226458ad2f9421669613b747

php-cache-max-age

300

x-powered-by

The love of games, an addiction to deals, and a bit of code! :)

Report-To

{"endpoints":\[{"url":"https:\\/\\/a.nel.cloudflare.com\\/report\\/v3?s=%2BA8YBQDPXSsCgxkjlxXA0LJium23eRlKT7S5T3jwCmc5DWLYiCmY2bKy2%2Bvyyv2Yp3C3%2FzBdcutm7AKMLoeC4QoTcxfm0mT89MluaMr0mjKiULHpBZvhvwVfe26XThYanYk4qQ%3D%3D"}\],"group":"cf-nel","max\_age":604800}

NEL

{"success\_fraction":0,"report\_to":"cf-nel","max\_age":604800}

Server

cloudflare

Content-Encoding

br