import * as path from 'node:path';
import protobuf from 'protobufjs';

export const Root = await protobuf.load(path.join(import.meta.dirname, 'schema.proto'));
export const Point = Root.lookupType('Point');
export const Person = Root.lookupType('Person');
