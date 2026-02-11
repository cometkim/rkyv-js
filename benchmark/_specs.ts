import * as r from 'rkyv-js';

interface Spec<T = unknown> {
  description: string;
  codec: r.RkyvCodec<T>,
  tests: Array<[
    description: string, 
    test: { input: T, expected: Uint8Array },
  ]>;
}

export function spec<T>(description: string, codec: r.RkyvCodec<T>, inputs: [string, T][]): Spec<T> {
  return {
    description,
    codec,
    tests: inputs.map(([description, input]) => [
      description,
      { input, expected: r.encode(codec, input) },
    ]),
  };
}

const Address = r.struct({
  street: r.string,
  city: r.string,
  state: r.string,
  zipCode: r.string,
  country: r.string,
});

export const specs: Spec[] = [
  spec(
    '2D point', 
    r.struct(({ x: r.f64, y: r.f64 })),
    [
      ['Simple 2D point', { x: 42.5, y: -17.25 }],
    ],
  ),

  spec(
    '3D vector',
    r.struct(({ x: r.f32, y: r.f32, z: r.f32, label: r.option(r.string) })),
    [
      ['Simple 3D vector with label', { x: 1.0, y: 2.0, z: 3.0, label: 'origin-offset' }],
    ],
  ),

  spec(
    'User profile',
    r.struct({
      id: r.u64,
      username: r.string,
      email: r.string,
      age: r.u8,
      verified: r.bool,
      bio: r.option(r.string),
      followerCount: r.u32,
      followingCount: r.u32,
    }),
    [
      ['User profile', {
        id: 12345678901234n,
        username: 'johndoe',
        email: 'john.doe@example.com',
        age: 28,
        verified: true,
        bio: 'Software developer passionate about Rust and TypeScript.',
        followerCount: 1523,
        followingCount: 234,
      }],
    ],
  ),

  spec(
    'Order',
    r.struct({
      orderId: r.u64,
      customerId: r.u64,
      items: r.vec(r.struct({
        productId: r.u64,
        name: r.string,
        quantity: r.u32,
        unitPrice: r.f64,
        discount: r.option(r.f64),
      })),
      shippingAddress: Address,
      billingAddress: r.option(Address),
      totalAmount: r.f64,
      status: r.string,
      createdAt: r.u64,
      updatedAt: r.option(r.u64),
    }),
    [
      ['Order (small)', {
        orderId: 1001n,
        customerId: 5001n,
        items: [
          {
            productId: 101n,
            name: 'Wireless Mouse',
            quantity: 1,
            unitPrice: 29.99,
            discount: null,
          },
          {
            productId: 102n,
            name: 'USB-C Cable',
            quantity: 2,
            unitPrice: 12.99,
            discount: 0.1,
          },
        ],
        shippingAddress: {
          street: '123 Main Street',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'USA',
        },
        billingAddress: null,
        totalAmount: 53.37,
        status: 'processing',
        createdAt: 1704067200000n,
        updatedAt: null,
      }],
      ['Order (large)', {
        orderId: 1002n,
        customerId: 5002n,
        items: Array.from({ length: 50 }, (_, i) => ({
          productId: BigInt(1000 + i),
          name: `Product ${i + 1} with a longer description`,
          quantity: Math.floor(Math.random() * 10) + 1,
          unitPrice: Math.random() * 100,
          discount: i % 3 === 0 ? 0.15 : null,
        })),
        shippingAddress: {
          street: '456 Oak Avenue, Apartment 12B',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
          country: 'United States of America',
        },
        billingAddress: {
          street: '789 Corporate Plaza, Suite 500',
          city: 'Chicago',
          state: 'IL',
          zipCode: '60601',
          country: 'United States of America',
        },
        totalAmount: 4523.87,
        status: 'shipped',
        createdAt: 1704067200000n,
        updatedAt: 1704153600000n,
      }],
    ],
  ),

  spec(
    'API response',
    r.taggedEnum({
      Success: r.struct({
        data: r.string,
        timestamp: r.u64,
      }),
      Error: r.struct({
        code: r.u32,
        message: r.string,
      }),
      Loading: r.unit,
      NotFound: r.unit,
    }),
    [
      ['ApiResponse->Success', {
        tag: 'Success',
        value: { data: '{"users": [1, 2, 3]}', timestamp: 1704067200000n },
      }],
      ['ApiResponse->Error', {
        tag: 'Error',
        value: { code: 404, message: 'Resource not found' },
      }],
      ['ApiResponse->Loading', {
        tag: 'Loading',
        value: null,
      }],
    ],
  ),

  spec(
    'Shape',
    r.taggedEnum({
      Circle: r.struct({ radius: r.f64 }),
      Rectangle: r.struct({ width: r.f64, height: r.f64 }),
      Triangle: r.struct({ base: r.f64, height: r.f64 }),
      Point: r.unit,
    }),
    [
      ['Shape->Circle', { tag: 'Circle', value: { radius: 5.0 } }],
      ['Shape->Rectangle', { tag: 'Rectangle', value: { width: 10.0, height: 20.0 } }],
      ['Shape->Point', { tag: 'Point', value: null }],
    ],
  ),

  spec(
    'Message',
    r.taggedEnum({
      Text: r.struct({
        content: r.string,
        edited: r.bool,
      }),
      Image: r.struct({
        url: r.string,
        width: r.u32,
        height: r.u32,
        caption: r.option(r.string),
      }),
      File: r.struct({
        url: r.string,
        filename: r.string,
        size: r.u64,
        mimeType: r.string,
      }),
      Reaction: r.struct({
        emoji: r.string,
        targetMessageId: r.u64,
      }),
      Deleted: r.unit,
    }),
    [
      ['Message->Text', {
        tag: 'Text',
        value: { content: 'Hello, world! How are you doing today?', edited: false },
      }],
      ['Message->Image', {
        tag: 'Image',
        value: {
          url: 'https://example.com/images/photo-12345.jpg',
          width: 1920,
          height: 1080,
          caption: 'Beautiful sunset at the beach',
        },
      }],
      ['Message->File', {
        tag: 'File',
        value: {
          url: 'https://example.com/files/document.pdf',
          filename: 'quarterly-report-2024.pdf',
          size: 2457600n,
          mimeType: 'application/pdf',
        },
      }],
    ],
  ),

  spec(
    'Event',
    r.taggedEnum({
      UserCreated: r.struct({
        userId: r.u64,
        username: r.string,
        email: r.string,
      }),
      UserUpdated: r.struct({
        userId: r.u64,
        fields: r.vec(r.string),
      }),
      UserDeleted: r.struct({
        userId: r.u64,
        reason: r.option(r.string),
      }),
      OrderPlaced: r.struct({
        orderId: r.u64,
        customerId: r.u64,
        totalAmount: r.f64,
      }),
      OrderShipped: r.struct({
        orderId: r.u64,
        trackingNumber: r.string,
      }),
      OrderDelivered: r.struct({
        orderId: r.u64,
        deliveredAt: r.u64,
      }),
    }),
    [
      ['Event->UserCreated', {
        tag: 'UserCreated',
        value: {
          userId: 12345n,
          username: 'newuser',
          email: 'newuser@example.com',
        },
      }],
      ['Event->OrderPlaced', {
        tag: 'OrderPlaced',
        value: {
          orderId: 9001n,
          customerId: 5001n,
          totalAmount: 299.99,
        },
      }],
    ],
  )
];
