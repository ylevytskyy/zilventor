import * as Comlink from 'comlink';
import { createKernelApi } from './api';

const api = createKernelApi();
// eslint-disable-next-line no-restricted-globals
Comlink.expose(api, self as unknown as Comlink.Endpoint);
