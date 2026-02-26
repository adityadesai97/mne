// src/__tests__/importExport.test.ts
import { serializeForExport, parseImport } from '../lib/importExport'

test('serializes assets to export format', () => {
  const data = {
    assets: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Cash',
        asset_type: 'Cash',
        location: { id: '22222222-2222-4222-8222-222222222222', name: 'Chase', account_type: 'Checking' },
        location_id: '22222222-2222-4222-8222-222222222222',
        stock_subtypes: [],
      },
    ],
    tickers: [],
    themes: [],
  }
  const result = serializeForExport(data)
  expect(result.schema).toBe('mne.export.v2')
  expect(result.version).toBe('2.0')
  expect(result.data.assets).toHaveLength(1)
  expect(result.data.locations).toHaveLength(1)
  expect(result.exportedAt).toBeDefined()
})

test('parses valid import JSON', () => {
  const raw = JSON.stringify({ assets: [], tickers: [], themes: [], version: '1.0' })
  const result = parseImport(raw)
  expect(result.assets).toEqual([])
  expect(result.tickers).toEqual([])
  expect(result.locations).toEqual([])
})

test('throws on invalid import JSON', () => {
  expect(() => parseImport('not json')).toThrow()
})

test('throws on missing assets array', () => {
  expect(() => parseImport('{"tickers":[]}')).toThrow('Invalid format')
})

test('parses canonical v2 schema', () => {
  const raw = JSON.stringify({
    schema: 'mne.export.v2',
    version: '2.0',
    exportedAt: '2026-02-17T00:00:00.000Z',
    data: {
      locations: [
        { id: '22222222-2222-4222-8222-222222222222', name: 'E*trade', accountType: 'Investment' },
      ],
      themes: [
        { id: '33333333-3333-4333-8333-333333333333', name: 'AI' },
      ],
      tickers: [
        { id: '44444444-4444-4444-8444-444444444444', symbol: 'CRM', currentPrice: 185.02, lastUpdated: '2026-02-17' },
      ],
      tickerThemes: [
        {
          tickerId: '44444444-4444-4444-8444-444444444444',
          themeId: '33333333-3333-4333-8333-333333333333',
        },
      ],
      themeTargets: [
        { id: '55555555-5555-4555-8555-555555555555', themeId: '33333333-3333-4333-8333-333333333333', targetPercentage: 35, isActive: true },
      ],
      assets: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          name: 'Salesforce, Inc.',
          assetType: 'Stock',
          locationId: '22222222-2222-4222-8222-222222222222',
          ownership: 'Individual',
          tickerId: '44444444-4444-4444-8444-444444444444',
        },
      ],
      stockSubtypes: [
        { id: '77777777-7777-4777-8777-777777777777', assetId: '66666666-6666-4666-8666-666666666666', subtype: 'RSU' },
      ],
      transactions: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          subtypeId: '77777777-7777-4777-8777-777777777777',
          count: 10,
          costPrice: 200,
          purchaseDate: '2026-02-17',
          capitalGainsStatus: 'Short Term',
        },
      ],
      rsuGrants: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          subtypeId: '77777777-7777-4777-8777-777777777777',
          grantDate: '2025-03-01',
          totalShares: 100,
          vestStart: '2025-03-01',
          vestEnd: '2027-03-01',
          cliffDate: '2025-09-01',
          endedAt: null,
        },
      ],
    },
  })

  const result = parseImport(raw)
  expect(result.version).toBe('2.0')
  expect(result.exportDate).toBe('2026-02-17')
  expect(result.locations).toHaveLength(1)
  expect(result.themes).toHaveLength(1)
  expect(result.tickerThemes).toHaveLength(1)
  expect(result.themeTargets).toHaveLength(1)
  expect(result.assets).toHaveLength(1)
  expect(result.assets[0].stockSubtypes[0].subtype).toBe('RSU')
  expect(result.assets[0].stockSubtypes[0].rsuGrants).toHaveLength(1)
})

test('parses Moola schema and normalizes fields', () => {
  const raw = JSON.stringify({
    version: '1.0',
    exportDate: '02/17/2026',
    stockTickers: [
      { id: '369213DE-CF82-4835-AFFA-4E35F01BFE2E', symbol: 'amzn', currentPrice: 200.78, lastUpdated: '02/17/2026' },
    ],
    assets: [
      {
        id: '667006D6-8007-459F-92D1-32FAE2B85DC5',
        assetTypeName: '401(k)',
        locationName: 'Fidelity',
        locationAccountType: 'investment',
        name: 'Salesforce 401(k)',
        ownership: 'Individual',
        price: 99286.64,
        stockSubtypes: [],
      },
      {
        id: 'BD954F53-74E6-402D-9E2A-93DB80754308',
        assetTypeName: 'Stock',
        locationName: 'Chase',
        locationAccountType: 'Investment',
        name: 'Amazon.com, Inc.',
        ownership: 'Individual',
        price: 200.78,
        ticker: 'amzn',
        stockSubtypes: [
          {
            subtype: 'Market',
            transactions: [
              {
                id: 'E1A6070E-63DD-46BF-BCC9-58AD5084CF4D',
                count: 40.86384,
                costPrice: 244.715132,
                purchaseDate: '01/27/2026',
                capitalGainsStatus: 'Short Term',
              },
            ],
          },
        ],
      },
    ],
  })
  const result = parseImport(raw)
  expect(result.exportDate).toBe('2026-02-17')
  expect(result.tickers[0].symbol).toBe('AMZN')
  expect(result.tickers[0].lastUpdated).toBe('2026-02-17')
  expect(result.assets[0].assetType).toBe('401k')
  expect(result.assets[0].accountType).toBe('Investment')
  expect(result.assets[1].tickerSymbol).toBe('AMZN')
  expect(result.assets[1].stockSubtypes[0].transactions[0].purchaseDate).toBe('2026-01-27')
})

test('imports RSU transactions nested inside grants', () => {
  const raw = JSON.stringify({
    version: '1.0',
    exportDate: '02/17/2026',
    assets: [
      {
        id: '47046B1F-4793-483F-AF22-191E084FF3FB',
        assetTypeName: 'Stock',
        locationName: 'E*trade',
        locationAccountType: 'Investment',
        name: 'Salesforce, Inc.',
        ownership: 'Individual',
        price: 185.02,
        ticker: 'CRM',
        stockSubtypes: [
          {
            id: 'CBF7B756-94D2-411A-A595-F526822A85D1',
            rsuGrants: [
              {
                id: 'F20118CB-6D35-4744-B579-3B645533EF43',
                grantDate: '03/22/2022',
                firstVestingDate: '12/22/2025',
                transactions: [
                  {
                    id: '6CD9F04B-8488-4DE9-96FF-F79753532982',
                    count: 33,
                    costPrice: 186.51,
                    purchaseDate: '03/22/2023',
                    capitalGainsStatus: 'Long Term',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  const result = parseImport(raw)
  const rsuSubtype = result.assets[0].stockSubtypes[0]
  expect(rsuSubtype.subtype).toBe('RSU')
  expect(rsuSubtype.rsuGrants).toHaveLength(1)
  expect(rsuSubtype.transactions).toHaveLength(1)
  expect(rsuSubtype.transactions[0].purchaseDate).toBe('2023-03-22')
  expect(rsuSubtype.rsuGrants[0].grantDate).toBe('2022-03-22')
  expect(rsuSubtype.rsuGrants[0].vestEnd).toBe('2025-12-22')
})

test('keeps RSU grants when dates use short year format', () => {
  const raw = JSON.stringify({
    version: '1.0',
    exportDate: '2/17/26',
    assets: [
      {
        assetTypeName: 'Stock',
        locationName: 'E*trade',
        locationAccountType: 'Investment',
        name: 'Salesforce, Inc.',
        ownership: 'Individual',
        ticker: 'CRM',
        stockSubtypes: [
          {
            subtype: 'RSU',
            rsuGrants: [
              {
                grantDate: '3/22/22',
                firstVestingDate: '12/22/25',
                unvestedCount: 15,
                transactions: [
                  {
                    count: 14,
                    costPrice: 249.69,
                    purchaseDate: '9/22/25',
                    capitalGainsStatus: 'Short Term',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  const result = parseImport(raw)
  const rsuSubtype = result.assets[0].stockSubtypes[0]
  expect(rsuSubtype.rsuGrants).toHaveLength(1)
  expect(rsuSubtype.rsuGrants[0].grantDate).toBe('2022-03-22')
  expect(rsuSubtype.rsuGrants[0].vestEnd).toBe('2025-12-22')
  expect(rsuSubtype.rsuGrants[0].totalShares).toBe(29)
})

test('parses multi-grant RSU bundles from Moola-style exports', () => {
  const raw = JSON.stringify({
    version: '1.0',
    exportDate: '02/17/2026',
    stockTickers: [
      { id: '131C224B-AA5F-4B5D-A77E-4807FA62F76C', symbol: 'CRM', currentPrice: 185.02, lastUpdated: '02/17/2026' },
    ],
    assets: [
      {
        id: 'DC11477A-357C-44DF-B362-E1BC8254E871',
        assetTypeName: 'Stock',
        locationName: 'E*trade',
        locationAccountType: 'Investment',
        name: 'Salesforce, Inc.',
        ownership: 'Individual',
        price: 185.02,
        ticker: 'CRM',
        stockSubtypes: [
          {
            id: 'CBF7B756-94D2-411A-A595-F526822A85D1',
            subtype: 'RSU',
            rsuGrants: [
              {
                id: 'F20118CB-6D35-4744-B579-3B645533EF43',
                grantDate: '03/22/2022',
                firstVestingDate: '12/22/2025',
                unvestedCount: 15,
                transactions: [
                  { id: '6CD9F04B-8488-4DE9-96FF-F79753532982', count: 33, costPrice: 186.51, purchaseDate: '03/22/2023' },
                ],
              },
              {
                id: 'B12D77E0-8FDE-4603-AF00-10B16FD4F7CC',
                grantDate: '03/22/2025',
                firstVestingDate: '03/22/2026',
                unvestedCount: 147,
                transactions: [],
              },
              {
                id: 'B1047A33-CBE4-40FD-9F2A-C2A77020E7C0',
                grantDate: '02/22/2021',
                unvestedCount: 0,
                transactions: [
                  { id: '01452546-BCCE-45F8-975B-5C35A48B7CCB', count: 31, costPrice: 149.25, purchaseDate: '11/22/2022' },
                  { id: '8996C0D8-A174-4AD8-B88B-710FFD9B01F3', count: 31, costPrice: 309.8, purchaseDate: '02/22/2025' },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  const result = parseImport(raw)
  const rsuSubtype = result.assets[0].stockSubtypes.find((subtype) => subtype.subtype === 'RSU')
  expect(rsuSubtype).toBeDefined()
  expect(rsuSubtype!.rsuGrants).toHaveLength(3)
  expect(rsuSubtype!.transactions).toHaveLength(3)
  expect(rsuSubtype!.rsuGrants.map((grant) => grant.id)).toContain('b12d77e0-8fde-4603-af00-10b16fd4f7cc')
})
