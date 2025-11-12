export const stripe = {
  customers: {
    retrieve: async (id: string) => ({
      id,
      email: `${id}@example.com`,
      name: 'Test Customer',
      created: Math.floor(Date.now() / 1000),
      currency: 'usd',
      default_source: null,
      delinquent: false,
      description: null,
      discount: null,
      invoice_prefix: null,
      invoice_settings: { default_payment_method: null },
      livemode: false,
      metadata: {},
      shipping: null,
      tax_exempt: 'none'
    }),

    list: async (params?: any) => ({
      object: 'list',
      data: [],
      has_more: false,
      url: '/v1/customers'
    })
  },

  subscriptions: {
    list: async (params?: any) => ({
      object: 'list',
      data: [],
      has_more: false,
      url: '/v1/subscriptions'
    }),

    cancel: async (id: string) => ({
      id,
      object: 'subscription',
      status: 'canceled',
      canceled_at: Math.floor(Date.now() / 1000)
    })
  },

  invoices: {
    list: async (params?: any) => ({
      object: 'list',
      data: [],
      has_more: false,
      url: '/v1/invoices'
    })
  },

  charges: {
    list: async (params?: any) => ({
      object: 'list',
      data: [],
      has_more: false,
      url: '/v1/charges'
    })
  }
}
