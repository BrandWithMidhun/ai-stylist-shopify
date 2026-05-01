// PR-D D.2: shop-level Admin GraphQL queries.
//
// SHOP_TIMEZONE_QUERY drives the cron-tick timezone refresh. ianaTimezone
// returns IANA-format strings (e.g. "Asia/Kolkata", "America/Los_Angeles")
// — exactly what Intl.DateTimeFormat({ timeZone }) accepts.

export const SHOP_TIMEZONE_QUERY = `#graphql
  query ShopTimezone {
    shop {
      ianaTimezone
    }
  }
`;

export type ShopTimezoneResponse = {
  data: {
    shop: {
      ianaTimezone: string;
    };
  };
};
