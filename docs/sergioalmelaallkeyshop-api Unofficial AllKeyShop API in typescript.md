# AllKeyShop API

Unofficial AllKeyShop API made in typescript

```shell
npm install allkeyshop-api
```

```ts
import { AllkeyshopService } from 'allkeyshop-api'

const allkeyshopService = new AllkeyshopService()
```

```ts
const options = {
    currency: 'eur',
    platform: '',
    store: 'steam'
}

const allkeyshopService = new AllkeyshopService(options)
```

-   Currency: Get prices in the selected currency. Default: eur
-   Platform: Get prices for the selected platform. Default: '' (PC). Possible values: 'PS5', 'Xbox One', 'Nintendo Switch' etc.
-   Store: Filter by selected store. Default: '' (any). Possible values: 'steam', 'origin', 'ea-app', 'uplay', 'gog', 'epic' etc.

```ts
allkeyshopService.search('Borderlands 3').then((data) => {
    console.log(data)
})

// Output:
// {
//     offers: [
//         {
//             merchant: 'Kinguin',
//             edition: 'Standard Edition',
//             region: 'Steam',
//             currentPrice: 38.66,
//             minDiscountPrice: 37.37,
//             couponCode: 'AKSGAME',
//             lastUpdate: '2026-06-19 18:28:55'
//         },
//         ...
//     ],
//     lowestPrices: {
//         official: {
//             merchant: 'Kinguin',
//             price: 38.66,
//             lastUpdate: '2026-06-19 18:28:55'
//         },
//         keyshops: {
//             merchant: 'G2A',
//             price: 41.19,
//             lastUpdate: '2026-06-19 03:02:53'
//         }
//     }
// }
```

Each offer already has its `merchant`, `edition` and `region` resolved to a readable name. `lowestPrices.official` is the cheapest official-store price and `lowestPrices.keyshops` the cheapest key-reseller price (either may be `null` when no data is available).

```ts
allkeyshopService.find('DARK SOULS III').then((data) => {
    console.log(data)
})

// Output:
// {
//     status: 'success', 
//     games: [
//          { id: '83060', name: 'DARK SOULS' },
//          { id: '83063', name: 'DARK SOULS REMASTERED' },
//          ...
//     ]
// }
```

Search for games and get the cheapest price for each platform

-   Search any game and get all key prices, including official stores and key resellers
-   Filter by platform
-   Filter by store
-   Search by specific currency

-   [![TypeScript](https://camo.githubusercontent.com/4893a8bd1dfacd6f50c7a4babe4484bc4af6c4987933c7e32033e7f4da429a31/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f547970655363726970742d3331373843363f7374796c653d666f722d7468652d6261646765266c6f676f3d54797065536372697074266c6f676f436f6c6f723d7768697465)](https://www.typescriptlang.org/)
-   [![Jest](https://camo.githubusercontent.com/8709ce68c6380f84c550a7a7a6926d41ec2e6e403068fff79e506d2a1d748ba2/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f4a6573742d4332313332353f7374796c653d666f722d7468652d6261646765266c6f676f3d4a657374266c6f676f436f6c6f723d7768697465)](https://jestjs.io/)

Feel free to submit issues and enhancement requests here: [Report Issue](https://github.com/sergioalmela/allkeyshop-api/issues)

If you want to support the project, you can buy me a coffee. Thanks!

[!["Buy Me A Coffee"](https://camo.githubusercontent.com/9f44ce2dc3b3eecdd02598900866ffc518801df1932849703dae1e5ce5031070/68747470733a2f2f7777772e6275796d6561636f666665652e636f6d2f6173736574732f696d672f637573746f6d5f696d616765732f6f72616e67655f696d672e706e67)](https://www.buymeacoffee.com/sergioalmela)

1.  **Fork** the repo on GitHub
2.  **Clone** the project to your own machine
3.  **Commit** changes to your own branch
4.  **Push** your work back up to your fork
5.  Submit a **Pull request** so that we can review your changes

NOTE: Be sure to merge the latest from "upstream" before making a pull request!