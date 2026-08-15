# Prices API

The GG.deals API offers programmatic access to our comprehensive price data.

To utilize this API, you will need a unique **API key**. You can generate this key in [your settings](https://gg.deals/settings/).

## Retrieve Game Prices by Steam App ID

To obtain price data for a game associated with a specific Steam App ID\*, make a GET request to the following URL:

`https://api.gg.deals/v1/prices/by-steam-app-id/`

\* Steam App IDs correspond to store pages such as `https://store.steampowered.com/app/<id>/`.

### Query Parameters

-   `key` - Your unique API key, which can be generated in [your settings](https://gg.deals/settings/).
-   `ids` - A comma-separated list of Steam App IDs (e.g., `1,2,3,4`), with a maximum of 100 IDs permitted per request.
-   `region` (optional) - The region code for which price data should be returned. By default, prices for the USA are provided.  
    Valid region codes include: `au`, `be`, `br`, `ca`, `ch`, `de`, `dk`, `es`, `eu`, `fi`, `fr`, `gb`, `ie`, `it`, `nl`, `no`, `pl`, `se` and `us`.

### Response

The response will be a JSON object containing a `data` field with a list of `GamePrices` objects for the requested Steam App IDs, indexed by their respective IDs. If a game is not found in our database for a specified Steam App ID, `null` will be returned for that ID.

The `GamePrices` object contains the following fields:

-   `title` - The title of the game in our database.
-   `url` - The URL of the game in our database.
-   `prices` - An object containing price data with the following fields:
    -   `currentRetail` - The current lowest price for retail stores, as a string (`null` if there is no current lowest price available for retail stores).
    -   `currentKeyshops` - The current lowest price for keyshops, as a string (`null` if there is no current lowest price available for keyshops).
    -   `historicalRetail` - The historical lowest price for retail stores, as a string (`null` if there is no historical lowest price available for retail stores).
    -   `historicalKeyshops` - The historical lowest price for keyshops, as a string (`null` if there is no historical lowest price available for keyshops).
    -   `currency` - The currency code used for all the above prices.

### Example

Example Request:

```
curl "https://api.gg.deals/v1/prices/by-steam-app-id/?ids=1,420&key=mySecretKey&region=pl"
```

Example Response:

```json
{
  "success": true,
  "data": {
    "1": null,
    "420": {
      "title": "Half-Life 2: Episode Two",
      "url": "https://gg.deals/game/half-life-2-episode-two/",
      "prices": {
        "currentRetail": "91.99",
        "currentKeyshops": "24.30",
        "historicalRetail": "2.89",
        "historicalKeyshops": "5.61",
        "currency": "PLN"
      }
    }
  }
}
```

## Retrieve Game Prices by Steam Sub ID

To obtain price data for a game associated with a specific Steam Sub ID\*, make a GET request to the following URL:

`https://api.gg.deals/v1/prices/by-steam-sub-id/`

\* Steam Sub IDs correspond to store pages such as `https://store.steampowered.com/sub/<id>/`.

### Query Parameters

-   `key` - Your unique API key, which can be generated in [your settings](https://gg.deals/settings/).
-   `ids` - A comma-separated list of Steam Sub IDs (e.g., `1,2,3,4`), with a maximum of 100 IDs permitted per request.
-   `region` (optional) - The region code for which price data should be returned. By default, prices for the USA are provided.  
    Valid region codes include: `au`, `be`, `br`, `ca`, `ch`, `de`, `dk`, `es`, `eu`, `fi`, `fr`, `gb`, `ie`, `it`, `nl`, `no`, `pl`, `se` and `us`.

### Response

The response will be a JSON object containing a `data` field with a list of `GamePrices` objects for the requested Steam Sub IDs, indexed by their respective IDs. If a game is not found in our database for a specified Steam Sub ID, `null` will be returned for that ID.

The `GamePrices` object contains the following fields:

-   `title` - The title of the game in our database.
-   `url` - The URL of the game in our database.
-   `prices` - An object containing price data with the following fields:
    -   `currentRetail` - The current lowest price for retail stores, as a string (`null` if there is no current lowest price available for retail stores).
    -   `currentKeyshops` - The current lowest price for keyshops, as a string (`null` if there is no current lowest price available for keyshops).
    -   `historicalRetail` - The historical lowest price for retail stores, as a string (`null` if there is no historical lowest price available for retail stores).
    -   `historicalKeyshops` - The historical lowest price for keyshops, as a string (`null` if there is no historical lowest price available for keyshops).
    -   `currency` - The currency code used for all the above prices.

### Example

Example Request:

```
curl "https://api.gg.deals/v1/prices/by-steam-sub-id/?ids=1,7&key=mySecretKey&region=pl"
```

Example Response:

```json
{
  "success": true,
  "data": {
    "1": null,
    "7": {
      "title": "Counter-Strike: Condition Zero Pack",
      "url": "https://gg.deals/pack/counter-strike-condition-zero-pack/",
      "prices": {
        "currentRetail": "35.99",
        "currentKeyshops": null,
        "historicalRetail": "3.59",
        "historicalKeyshops": "6.48",
        "currency": "PLN"
      }
    }
  }
}
```

## Retrieve Game Prices by Steam Bundle ID

To obtain price data for a game associated with a specific Steam Bundle ID\*, make a GET request to the following URL:

`https://api.gg.deals/v1/prices/by-steam-bundle-id/`

\* Steam Bundle IDs correspond to store pages such as `https://store.steampowered.com/bundle/<id>/`.

### Query Parameters

-   `key` - Your unique API key, which can be generated in [your settings](https://gg.deals/settings/).
-   `ids` - A comma-separated list of Steam Bundle IDs (e.g., `1,2,3,4`), with a maximum of 100 IDs permitted per request.
-   `region` (optional) - The region code for which price data should be returned. By default, prices for the USA are provided.  
    Valid region codes include: `au`, `be`, `br`, `ca`, `ch`, `de`, `dk`, `es`, `eu`, `fi`, `fr`, `gb`, `ie`, `it`, `nl`, `no`, `pl`, `se` and `us`.

### Response

The response will be a JSON object containing a `data` field with a list of `GamePrices` objects for the requested Steam Bundle IDs, indexed by their respective IDs. If a game is not found in our database for a specified Steam Bundle ID, `null` will be returned for that ID.

The `GamePrices` object contains the following fields:

-   `title` - The title of the game in our database.
-   `url` - The URL of the game in our database.
-   `prices` - An object containing price data with the following fields:
    -   `currentRetail` - The current lowest price for retail stores, as a string (`null` if there is no current lowest price available for retail stores).
    -   `currentKeyshops` - The current lowest price for keyshops, as a string (`null` if there is no current lowest price available for keyshops).
    -   `historicalRetail` - The historical lowest price for retail stores, as a string (`null` if there is no historical lowest price available for retail stores).
    -   `historicalKeyshops` - The historical lowest price for keyshops, as a string (`null` if there is no historical lowest price available for keyshops).
    -   `currency` - The currency code used for all the above prices.

### Example

Example Request:

```
curl "https://api.gg.deals/v1/prices/by-steam-bundle-id/?ids=1,232&key=mySecretKey&region=pl"
```

Example Response:

```json
{
  "success": true,
  "data": {
    "1": null,
    "232": {
      "title": "Valve Complete Pack",
      "url": "https://gg.deals/pack/valve-complete-pack/",
      "prices": {
        "currentRetail": "520.04",
        "currentKeyshops": null,
        "historicalRetail": "27.84",
        "historicalKeyshops": "145.19",
        "currency": "PLN"
      }
    }
  }
}
```

## Rate Limits

Your API key allows you to retrieve up to 100 records per minute, with a maximum of 1000 per hour. For the [`by-steam-app-id`](https://gg.deals/api/prices/#by-steam-app-id), [`by-steam-sub-id`](https://gg.deals/api/prices/#by-steam-sub-id) and [`by-steam-bundle-id`](https://gg.deals/api/prices/#by-steam-bundle-id) endpoints, each ID counts as one record against your limits. Note that any invalid request also counts against these limits.

All API responses include the following headers with rate limit information:

## Rate Limits

-   `x-ratelimit-limit` - The total number of allowed requests within the current time frame.
-   `x-ratelimit-remaining` - The number of remaining requests available within the current time frame.
-   `x-ratelimit-reset` - The timestamp when the rate limits will reset.

If you exceed your rate limit, a `429` error (Too Many Requests) will be returned with the following response:

Example Response:

```json
{
  "success": false,
  "data": {
    "name": "Too Many Requests",
    "message": "You can fetch prices info only for 100 games per minute. Try again later.",
    "code": 429,
    "status": 429
  }
}
```

An error `429` is also returned if you attempt to fetch more items than your remaining limit allows. For example, if you try to fetch prices for 10 games but your remaining limit is only 5, a `429` error will occur and no data will be returned. In such cases, you should either reduce the number of requested IDs or wait until your rate limit resets.

## Changelog

This section tracks API changes and updates over time. If you want to be notified about changes in API, subscribe to [this discussion on our forum](https://forum.gg.deals/d/1779-api-changelog).

## Changelog

-   **2026-04-30** - Added `by-steam-sub-id` and `by-steam-bundle-id` endpoints.
-   **2025-05-19** - Initial API release.