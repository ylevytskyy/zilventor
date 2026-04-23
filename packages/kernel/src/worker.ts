import * as Comlink from 'comlink';
import { createKernelApi } from './api';

const api = createKernelApi();
Comlink.expose(api, self as unknown as Comlink.Endpoint);
