export const AVAILABLE_FUNCTIONS = [
  {
    name: 'getAllProducts',
    description: 'Get all available products from the catalog',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getUserDetailsByPhoneNo',
    description: 'Get user details by phone number',
    parameters: {
      type: 'object',
      properties: {
        phoneNo: {
          type: 'string',
          description: "User's phone number",
        },
      },
      required: ['phoneNo'],
    },
  },
  {
    name: 'getAllOrders',
    description: 'Get all orders of that customer from the system',
    parameters: {
      type: 'object',
      properties: {
        phoneNo: {
          type: 'string',
          description: "User's phone number",
        },
      },
      required: ['phoneNo'],
    },
  },
  {
    name: 'getOrderById',
    description: 'Get order details by order ID',
    parameters: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'The unique order identifier',
        },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'cancelOrder',
    description:
      'Cancel a Shopify order with specified options. This function can cancel an order, issue refunds, restock items, and send notification emails to customers.',
    parameters: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'The Shopify order ID to cancel. Can be either a numeric ID or full GraphQL ID.',
        },
        reason: {
          type: 'string',
          description: 'The reason for cancelling the order',
          enum: ['CUSTOMER', 'FRAUD', 'INVENTORY', 'DECLINED', 'OTHER'],
          default: 'OTHER',
        },
        email: {
          type: 'boolean',
          description: 'Whether to send a cancellation email to the customer',
          default: true,
        },
        refund: {
          type: 'boolean',
          description: 'Whether to issue a refund for the cancelled order',
          default: true,
        },
        restock: {
          type: 'boolean',
          description: 'Whether to restock the cancelled items back to inventory',
          default: true,
        },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'checkOrderCancellable',
    description:
      "Check if a Shopify order can be cancelled. This function verifies the order status and returns whether cancellation is possible along with the reason if it's not cancellable.",
    parameters: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: 'The Shopify order ID to check. Can be either a numeric ID or full GraphQL ID.',
        },
      },
      required: ['orderId'],
    },
  },
];


