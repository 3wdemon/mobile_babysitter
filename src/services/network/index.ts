/**
 * Public surface for the network-status service (DMY-60).
 */
export {
  ONLINE_STATE,
  noopNetworkSource,
  mapNetInfoState,
  createSourceFromNetInfo,
  createNetworkSource,
  getNetworkSource,
  __setNetworkSource,
  type NetworkState,
  type NetworkListener,
  type NetworkSource,
} from './networkStatus';
