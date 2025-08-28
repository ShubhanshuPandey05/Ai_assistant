const fetch = global.fetch || require('node-fetch');
const { SHOPIFY_ACCESS_TOKEN, getShopifyGraphQLEndpoint } = require('../config');

async function shopifyGraphQL(query, variables = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(getShopifyGraphQLEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok || json.errors) {
      const err = new Error('Shopify GraphQL error');
      err.status = res.status;
      err.details = json.errors || json;
      throw err;
    }
    return json.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAllProducts(cursor = null) {
  const query = `{
    products(first: 50${cursor ? `, after: "${cursor}"` : ''}) {
      edges { cursor node { id title handle description variants(first: 10) { edges { node { id title } } } } }
      pageInfo { hasNextPage }
    }
  }`;
  const data = await shopifyGraphQL(query);
  const edges = data.products?.edges || [];
  return edges.map(e => ({
    id: e.node.id,
    title: e.node.title,
    handle: e.node.handle,
    description: e.node.description,
    variants: (e.node.variants?.edges || []).map(v => ({ id: v.node.id, title: v.node.title }))
  }));
}

async function getUserDetailsByPhoneNo(phone) {
  const query = `{
    customers(first: 1, query: "phone:${phone}") { edges { node { id firstName lastName email phone numberOfOrders } } }
  }`;
  const data = await shopifyGraphQL(query);
  const node = data.customers?.edges?.[0]?.node;
  if (!node) return null;
  return {
    id: node.id,
    firstName: node.firstName,
    lastName: node.lastName,
    email: node.email,
    phone: node.phone,
    ordersCount: node.numberOfOrders,
  };
}

async function getAllOrders(phone, cursor = null) {
  const customer = await getUserDetailsByPhoneNo(phone);
  if (!customer?.id) return { orders: [], hasNextPage: false, lastCursor: null };
  const customerId = customer.id.split('/').pop();
  const query = `{
    orders(first: 50${cursor ? `, after: "${cursor}"` : ''}, query: "customer_id:${customerId} AND status:open") {
      edges { cursor node { id name email phone totalPriceSet { shopMoney { amount currencyCode } } createdAt fulfillments { status } lineItems(first: 10) { edges { node { title quantity } } } } }
      pageInfo { hasNextPage }
    }
  }`;
  const data = await shopifyGraphQL(query);
  const edges = data.orders?.edges || [];
  return {
    orders: edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      email: e.node.email,
      phone: e.node.phone,
      total: e.node.totalPriceSet?.shopMoney?.amount,
      currency: e.node.totalPriceSet?.shopMoney?.currencyCode,
      createdAt: e.node.createdAt,
      fulfillmentStatus: (e.node.fulfillments || []).map(f => f.status).join(', '),
      lineItems: (e.node.lineItems?.edges || []).map(li => ({ title: li.node.title, quantity: li.node.quantity }))
    })),
    hasNextPage: data.orders?.pageInfo?.hasNextPage || false,
    lastCursor: edges.length ? edges[edges.length - 1].cursor : null,
  };
}

async function getOrderById(orderId) {
  if (!orderId.startsWith('gid://')) orderId = `gid://shopify/Order/${orderId}`;
  const query = `query GetOrder($id: ID!) { order(id: $id) {
    id name email phone totalPriceSet { shopMoney { amount currencyCode } } createdAt fulfillments { status } lineItems(first: 10) { edges { node { title quantity } } }
  } }`;
  const data = await shopifyGraphQL(query, { id: orderId });
  const o = data.order;
  if (!o) return null;
  return {
    id: o.id,
    name: o.name,
    email: o.email,
    phone: o.phone,
    total: o.totalPriceSet?.shopMoney?.amount || '0',
    currency: o.totalPriceSet?.shopMoney?.currencyCode || 'USD',
    createdAt: o.createdAt,
    fulfillmentStatus: (o.fulfillments || []).map(f => f.status).join(', ') || 'unfulfilled',
    lineItems: (o.lineItems?.edges || []).map(li => ({ title: li.node.title, quantity: li.node.quantity })),
  };
}

async function cancelOrder(orderId, options = {}) {
  if (!orderId.startsWith('gid://')) orderId = `gid://shopify/Order/${orderId}`;
  const query = `mutation OrderCancel($orderId: ID!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!, $reason: OrderCancelReason!, $staffNote: String) {
    orderCancel(orderId: $orderId, notifyCustomer: $notifyCustomer, refundMethod: $refundMethod, restock: $restock, reason: $reason, staffNote: $staffNote) {
      job { id done }
      orderCancelUserErrors { field message code }
      userErrors { field message }
    }
  }`;
  const variables = {
    orderId,
    notifyCustomer: options.email !== false,
    refundMethod: { originalPaymentMethodsRefund: options.refund !== false },
    restock: options.restock !== false,
    reason: options.reason || 'OTHER',
    staffNote: options.staffNote || undefined,
  };
  const data = await shopifyGraphQL(query, variables);
  return data.orderCancel;
}

module.exports = {
  getAllProducts,
  getUserDetailsByPhoneNo,
  getAllOrders,
  getOrderById,
  cancelOrder,
};


