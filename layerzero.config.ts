import { EndpointId } from '@layerzerolabs/lz-definitions';
export const layerZeroConfig: any = {
  networks: {
    ethereum: {
      endpoint: '0x1a44076050125825900e736c501f859c50fE728c',
      chainId: 1,
      eid: EndpointId.ETHEREUM_V2_MAINNET,
    },
    flare: {
      endpoint: '0x1a44076050125825900e736c501f859c50fE728c',
      chainId: 14,
      eid: EndpointId.FLARE_V2_MAINNET,
    },
  },
  contracts: {
    USNUpgradeable: {
      ethereum: '',
      flare: '',
    },
  },
};
