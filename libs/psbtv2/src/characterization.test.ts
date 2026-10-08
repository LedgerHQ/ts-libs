import { createHash } from "crypto";
import { BufferReader, BufferWriter, unsafeTo64bitLE } from "./buffertools";
import { PsbtV2, psbtIn, psbtOut } from "./psbtv2";

type Fixture = {
  name: string;
  allowTxnVersion1: boolean;
  v0: string;
  v2: string;
  txVersion: number;
  locktime: number;
  inputs: number;
  outputAmounts: number[];
};

const HASH_253_INPUTS = "ea0ddac5a0c2505c9ffaf7f4fb55d070936fead565b8e891597f5c200c87eded";

const attempt = <T>(fn: () => T): T | undefined => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

const FIXTURES: Fixture[] = [
  {
    name: "unsigned-p2wpkh-v2-locktime",
    allowTxnVersion1: false,
    v0: "70736274ff010052020000000101010101010101010101010101010101010101010101010101010101010101010300000000fdffffff01905f010000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c120a107000001011fa08601000000000016001479b000887626b294a914501a4cd226b58b2359830000",
    v2: "70736274ff0102040200000001030420a10700010401010105010101fb040200000000010e200101010101010101010101010101010101010101010101010101010101010101010f0403000000011004fdffffff01011fa08601000000000016001479b000887626b294a914501a4cd226b58b23598300010308905f0100000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100",
    txVersion: 2,
    locktime: 500000,
    inputs: 1,
    outputAmounts: [90000],
  },
  {
    name: "unsigned-p2wpkh-v1",
    allowTxnVersion1: true,
    v0: "70736274ff010052010000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff01905f010000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000000001011fa08601000000000016001479b000887626b294a914501a4cd226b58b2359830000",
    v2: "70736274ff0102040100000001030400000000010401010105010101fb040200000000010e200101010101010101010101010101010101010101010101010101010101010101010f0400000000011004ffffffff01011fa08601000000000016001479b000887626b294a914501a4cd226b58b23598300010308905f0100000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100",
    txVersion: 1,
    locktime: 0,
    inputs: 1,
    outputAmounts: [90000],
  },
  {
    name: "signed-2in-3out-bip32-sighash",
    allowTxnVersion1: true,
    v0: "70736274ff0100bc02000000020a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0000000000ffffffff0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0100000000feffffff03f049020000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1409c0000000000001976a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188ac102700000000000016001479b000887626b294a914501a4cd226b58b235983000000000001011fa08601000000000016001479b000887626b294a914501a4cd226b58b2359832202031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f473044022010e02bd5c45dccbf6c1a1e12b94dfef9dce4c118a28526e6831f1b7fb00606ae022050c14b10218a17cd8e6c42b8ac8c1e79e575ceb8df0766b443117cdfbc23006d03010304030000002206031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f18deadbeef54000080010000800000008000000000000000000001011fb0ad01000000000016001479b000887626b294a914501a4cd226b58b2359832202031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f483045022100cdc552bef7613169a98b124cb0c5b3ba42a8873482e04919bc76342f8fd41d6902207bf39f401f3761a9614a519152af09349397101ebf93c81b5af8855612ddd38d03010304030000002206031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f18deadbeef5400008001000080000000800000000001000000002202024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d076618deadbeef5400008001000080000000800100000007000000000000",
    v2: "70736274ff0102040200000001030400000000010401020105010301fb040200000000010e200a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a010f0400000000011004ffffffff01011fa08601000000000016001479b000887626b294a914501a4cd226b58b235983010304030000002206031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f18deadbeef54000080010000800000008000000000000000002202031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f473044022010e02bd5c45dccbf6c1a1e12b94dfef9dce4c118a28526e6831f1b7fb00606ae022050c14b10218a17cd8e6c42b8ac8c1e79e575ceb8df0766b443117cdfbc23006d0300010e200b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b010f0401000000011004feffffff01011fb0ad01000000000016001479b000887626b294a914501a4cd226b58b235983010304030000002206031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f18deadbeef54000080010000800000008000000000010000002202031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f483045022100cdc552bef7613169a98b124cb0c5b3ba42a8873482e04919bc76342f8fd41d6902207bf39f401f3761a9614a519152af09349397101ebf93c81b5af8855612ddd38d0300010308f0490200000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c12202024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d076618deadbeef540000800100008000000080010000000700000000010308409c00000000000001041976a914ebc0ee0b2ab9e8277a600c251475e22a3241a1c188ac000103081027000000000000010416001479b000887626b294a914501a4cd226b58b23598300",
    txVersion: 2,
    locktime: 0,
    inputs: 2,
    outputAmounts: [150000, 40000, 10000],
  },
  {
    name: "finalized-p2wpkh",
    allowTxnVersion1: true,
    v0: "70736274ff010052020000000107070707070707070707070707070707070707070707070707070707070707070100000000ffffffff0180a9030000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000000001011f90d003000000000016001479b000887626b294a914501a4cd226b58b23598301086c02483045022100e74c150db473c8d85b8354ff5fc80fc09582d9ccd3405473138ff2e8a9922e920220145f1e93a5297c906dca990c61d39b2c69170a20b3f5718e3b11c11bf5e07e1f0121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f0000",
    v2: "70736274ff0102040200000001030400000000010401010105010101fb040200000000010e200707070707070707070707070707070707070707070707070707070707070707010f0401000000011004ffffffff01011f90d003000000000016001479b000887626b294a914501a4cd226b58b23598301086c02483045022100e74c150db473c8d85b8354ff5fc80fc09582d9ccd3405473138ff2e8a9922e920220145f1e93a5297c906dca990c61d39b2c69170a20b3f5718e3b11c11bf5e07e1f0121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f0001030880a90300000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100",
    txVersion: 2,
    locktime: 0,
    inputs: 1,
    outputAmounts: [240000],
  },
  {
    name: "signed-p2pkh-nonwitness-big",
    allowTxnVersion1: true,
    v0: "70736274ff0100520200000001be27133c20b3ecd1a4346bf596c6bc25f641299c373c68a570835fe8a4e7636b0100000000ffffffff018403000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100000000000100fdaa010200000001abababababababababababababababababababababababababababababababab0000000000ffffffff0ce803000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1e9030000000000001976a91479b000887626b294a914501a4cd226b58b23598388acea03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1eb03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ec03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ed03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ee03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ef03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f003000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f103000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f203000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f303000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000002202031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f483045022100ed61edc1bc5c76b211f0c35baa5022f774d4c363c5390fafbb9c7b3cab5342bd02204a358e51981f697b1f657d31c71df5b346fe217259f505b36ea6a7c44bd33fa8010000",
    v2: "70736274ff0102040200000001030400000000010401010105010101fb040200000000010e20be27133c20b3ecd1a4346bf596c6bc25f641299c373c68a570835fe8a4e7636b010f0401000000011004ffffffff0100fdaa010200000001abababababababababababababababababababababababababababababababab0000000000ffffffff0ce803000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1e9030000000000001976a91479b000887626b294a914501a4cd226b58b23598388acea03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1eb03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ec03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ed03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ee03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ef03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f003000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f103000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f203000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f303000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000002202031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f483045022100ed61edc1bc5c76b211f0c35baa5022f774d4c363c5390fafbb9c7b3cab5342bd02204a358e51981f697b1f657d31c71df5b346fe217259f505b36ea6a7c44bd33fa8010001030884030000000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100",
    txVersion: 2,
    locktime: 0,
    inputs: 1,
    outputAmounts: [900],
  },
  {
    name: "finalized-p2pkh-nonwitness-big",
    allowTxnVersion1: true,
    v0: "70736274ff0100520200000001be27133c20b3ecd1a4346bf596c6bc25f641299c373c68a570835fe8a4e7636b0100000000ffffffff018403000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100000000000100fdaa010200000001abababababababababababababababababababababababababababababababab0000000000ffffffff0ce803000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1e9030000000000001976a91479b000887626b294a914501a4cd226b58b23598388acea03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1eb03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ec03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ed03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ee03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ef03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f003000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f103000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f203000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f303000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c10000000001076b483045022100ed61edc1bc5c76b211f0c35baa5022f774d4c363c5390fafbb9c7b3cab5342bd02204a358e51981f697b1f657d31c71df5b346fe217259f505b36ea6a7c44bd33fa80121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f0000",
    v2: "70736274ff0102040200000001030400000000010401010105010101fb040200000000010e20be27133c20b3ecd1a4346bf596c6bc25f641299c373c68a570835fe8a4e7636b010f0401000000011004ffffffff0100fdaa010200000001abababababababababababababababababababababababababababababababab0000000000ffffffff0ce803000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1e9030000000000001976a91479b000887626b294a914501a4cd226b58b23598388acea03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1eb03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ec03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ed03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ee03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1ef03000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f003000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f103000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f203000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1f303000000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c10000000001076b483045022100ed61edc1bc5c76b211f0c35baa5022f774d4c363c5390fafbb9c7b3cab5342bd02204a358e51981f697b1f657d31c71df5b346fe217259f505b36ea6a7c44bd33fa80121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f0001030884030000000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c100",
    txVersion: 2,
    locktime: 0,
    inputs: 1,
    outputAmounts: [900],
  },
  {
    name: "finalized-p2sh-p2wpkh-redeem",
    allowTxnVersion1: true,
    v0: "70736274ff010052020000000109090909090909090909090909090909090909090909090909090909090909090000000000ffffffff01801a060000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000000001012020a107000000000017a91427f7b1d97b04ec10e77d4b1527dbb8c9f92c54b58701071716001479b000887626b294a914501a4cd226b58b23598301086b024730440220310924d6656003d7a59bbd51c6fd1851e442d45e4f55afef2de1cff7efce669c02200f82596156ad6f9e5f6c7af5efdafcfdd2b11c2f8bdf243dd47051e72187ef1a0121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f00010016001479b000887626b294a914501a4cd226b58b23598300",
    v2: "70736274ff0102040200000001030400000000010401010105010101fb040200000000010e200909090909090909090909090909090909090909090909090909090909090909010f0400000000011004ffffffff01012020a107000000000017a91427f7b1d97b04ec10e77d4b1527dbb8c9f92c54b58701071716001479b000887626b294a914501a4cd226b58b23598301086b024730440220310924d6656003d7a59bbd51c6fd1851e442d45e4f55afef2de1cff7efce669c02200f82596156ad6f9e5f6c7af5efdafcfdd2b11c2f8bdf243dd47051e72187ef1a0121031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f00010308801a0600000000000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1010016001479b000887626b294a914501a4cd226b58b23598300",
    txVersion: 2,
    locktime: 0,
    inputs: 1,
    outputAmounts: [400000],
  },
  {
    name: "large-amounts",
    allowTxnVersion1: true,
    v0: "70736274ff010071020000000105050505050505050505050505050505050505050505050505050505050505050000000000ffffffff02183c075af0750700160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000000100000016001479b000887626b294a914501a4cd226b58b235983000000000001011f0040075af075070016001479b000887626b294a914501a4cd226b58b235983000000",
    v2: "70736274ff0102040200000001030400000000010401010105010201fb040200000000010e200505050505050505050505050505050505050505050505050505050505050505010f0400000000011004ffffffff01011f0040075af075070016001479b000887626b294a914501a4cd226b58b23598300010308183c075af07507000104160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000103080000000001000000010416001479b000887626b294a914501a4cd226b58b23598300",
    txVersion: 2,
    locktime: 0,
    inputs: 1,
    outputAmounts: [2099999999999000, 4294967296],
  },
];

const V1_PSBT_V0 =
  "70736274ff010052010000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff01905f010000000000160014ebc0ee0b2ab9e8277a600c251475e22a3241a1c1000000000001011fa08601000000000016001479b000887626b294a914501a4cd226b58b2359830000";

const hex = (b: Buffer | undefined) => b?.toString("hex");

function dump(psbt: PsbtV2) {
  const inputs = [];
  for (let i = 0; i < psbt.getGlobalInputCount(); i++) {
    const witnessUtxo = psbt.getInputWitnessUtxo(i);
    inputs.push({
      txid: hex(psbt.getInputPreviousTxid(i)),
      index: psbt.getInputOutputIndex(i),
      sequence: psbt.getInputSequence(i),
      witnessUtxo: witnessUtxo && [hex(witnessUtxo.amount), hex(witnessUtxo.scriptPubKey)],
      nonWitnessUtxo: hex(psbt.getInputNonWitnessUtxo(i)),
      redeemScript: hex(psbt.getInputRedeemScript(i)),
      sighashType: psbt.getInputSighashType(i),
      partialSigs: psbt
        .getInputKeyDatas(i, psbtIn.PARTIAL_SIG)
        .map(pk => [hex(pk), hex(psbt.getInputPartialSig(i, pk))]),
      derivations: psbt.getInputKeyDatas(i, psbtIn.BIP32_DERIVATION).map(pk => {
        const d = psbt.getInputBip32Derivation(i, pk);
        return [hex(pk), hex(d?.masterFingerprint), d?.path];
      }),
      finalScriptSig: hex(psbt.getInputFinalScriptsig(i)),
      finalScriptWitness: attempt(() => hex(psbt.getInputFinalScriptwitness(i))),
    });
  }
  const outputs = [];
  for (let i = 0; i < psbt.getGlobalOutputCount(); i++) {
    outputs.push({
      amount: psbt.getOutputAmount(i),
      script: hex(psbt.getOutputScript(i)),
      derivations: psbt.getOutputKeyDatas(i, psbtOut.BIP_32_DERIVATION).map(pk => {
        const d = psbt.getOutputBip32Derivation(i, pk);
        return [hex(pk), hex(d.masterFingerprint), d.path];
      }),
    });
  }
  return { inputs, outputs };
}

function buildPsbtV0(inputCount: number): Buffer {
  const tx = new BufferWriter();
  tx.writeUInt32(2);
  tx.writeVarInt(inputCount);
  for (let i = 0; i < inputCount; i++) {
    tx.writeSlice(Buffer.alloc(32, (i % 250) + 1));
    tx.writeUInt32(i);
    tx.writeVarSlice(Buffer.alloc(0));
    tx.writeUInt32(0xfffffffd);
  }
  tx.writeVarInt(1);
  tx.writeUInt64(1000);
  tx.writeVarSlice(Buffer.from("0014" + "22".repeat(20), "hex"));
  tx.writeUInt32(0);

  const psbt = new BufferWriter();
  psbt.writeSlice(Buffer.from("70736274ff", "hex"));
  psbt.writeVarSlice(Buffer.from("00", "hex"));
  psbt.writeVarSlice(tx.buffer());
  psbt.writeUInt8(0);
  for (let i = 0; i < inputCount; i++) {
    const witnessUtxo = new BufferWriter();
    witnessUtxo.writeUInt64(1000 + i);
    witnessUtxo.writeVarSlice(Buffer.from("0014" + "11".repeat(20), "hex"));
    psbt.writeVarSlice(Buffer.from("01", "hex"));
    psbt.writeVarSlice(witnessUtxo.buffer());
    psbt.writeUInt8(0);
  }
  psbt.writeUInt8(0);
  return psbt.buffer();
}

describe("PsbtV2 characterization", () => {
  describe("fromV0 golden outputs", () => {
    it.each(FIXTURES)("$name", fixture => {
      const psbt = PsbtV2.fromV0(Buffer.from(fixture.v0, "hex"), fixture.allowTxnVersion1);

      expect(psbt.serialize().toString("hex")).toBe(fixture.v2);
      expect(psbt.getGlobalTxVersion()).toBe(fixture.txVersion);
      expect(psbt.getGlobalFallbackLocktime()).toBe(fixture.locktime);
      expect(psbt.getGlobalPsbtVersion()).toBe(2);
      expect(psbt.getGlobalInputCount()).toBe(fixture.inputs);
      expect(psbt.getGlobalOutputCount()).toBe(fixture.outputAmounts.length);
      fixture.outputAmounts.forEach((amount, i) => {
        expect(psbt.getOutputAmount(i)).toBe(amount);
      });
    });

    it.each(FIXTURES)("$name survives a deserialize/serialize round trip", fixture => {
      const original = PsbtV2.fromV0(Buffer.from(fixture.v0, "hex"), fixture.allowTxnVersion1);
      const reread = new PsbtV2();
      reread.deserialize(Buffer.from(fixture.v2, "hex"));

      expect(reread.serialize().toString("hex")).toBe(fixture.v2);
      expect(dump(reread)).toEqual(dump(original));
      expect(PsbtV2.getPsbtVersionNumber(Buffer.from(fixture.v2, "hex"))).toBe(2);
      expect(PsbtV2.getPsbtVersionNumber(Buffer.from(fixture.v0, "hex"))).toBe(0);
    });

    it("rejects a version 1 transaction unless allowed", () => {
      expect(() => PsbtV2.fromV0(Buffer.from(V1_PSBT_V0, "hex"))).toThrow(
        /Transaction version 1 detected/,
      );
      expect(() => PsbtV2.fromV0(Buffer.from(V1_PSBT_V0, "hex"), true)).not.toThrow();
    });

    it("converts a PSBT with 253 inputs, whose counts need a 3-byte VarInt", () => {
      const psbt = PsbtV2.fromV0(buildPsbtV0(253), true);
      const serialized = psbt.serialize();

      expect(psbt.getGlobalInputCount()).toBe(253);
      expect(createHash("sha256").update(serialized).digest("hex")).toBe(HASH_253_INPUTS);

      const reread = new PsbtV2();
      reread.deserialize(serialized);
      expect(reread.getGlobalInputCount()).toBe(253);
      expect(reread.getInputOutputIndex(252)).toBe(252);
      expect(hex(reread.getInputWitnessUtxo(252)?.amount)).toBe(
        Buffer.from(unsafeTo64bitLE(1000 + 252)).toString("hex"),
      );
      expect(reread.serialize().equals(serialized)).toBe(true);
    });

    it.each([
      ["empty", ""],
      ["bad magic", "00".repeat(40)],
      ["truncated", FIXTURES[0].v0.slice(0, 60)],
    ])("rejects an invalid PSBT: %s", (_name, bytes) => {
      expect(() => PsbtV2.fromV0(Buffer.from(bytes, "hex"), true)).toThrow(/./);
    });
  });

  describe("manual PsbtV2 round trips with large values", () => {
    it.each([0, 1, 252, 253, 65535, 65536, 70000])(
      "round trips a %i-byte non-witness UTXO value",
      length => {
        const utxo = Buffer.alloc(length, 0xab);
        const psbt = new PsbtV2();
        psbt.setGlobalTxVersion(2);
        psbt.setGlobalInputCount(1);
        psbt.setGlobalOutputCount(1);
        psbt.setGlobalPsbtVersion(2);
        psbt.setInputPreviousTxId(0, Buffer.alloc(32, 1));
        psbt.setInputOutputIndex(0, 0xffffffff);
        psbt.setInputSequence(0, 0xfffffffe);
        psbt.setInputNonWitnessUtxo(0, utxo);
        psbt.setOutputAmount(0, Number.MAX_SAFE_INTEGER);
        psbt.setOutputScript(0, Buffer.from("0014" + "33".repeat(20), "hex"));

        const serialized = psbt.serialize();
        const reread = new PsbtV2();
        reread.deserialize(serialized);

        expect(reread.getInputNonWitnessUtxo(0)).toEqual(utxo);
        expect(reread.getInputOutputIndex(0)).toBe(0xffffffff);
        expect(reread.getInputSequence(0)).toBe(0xfffffffe);
        expect(reread.getOutputAmount(0)).toBe(Number.MAX_SAFE_INTEGER);
        expect(reread.serialize().equals(serialized)).toBe(true);
      },
    );

    it("rejects an invalid magic", () => {
      expect(() => new PsbtV2().deserialize(Buffer.alloc(10))).toThrow("Invalid magic bytes");
    });
  });

  describe("VarInt", () => {
    const vectors: [number, string][] = [
      [0, "00"],
      [1, "01"],
      [0xfc, "fc"],
      [0xfd, "fdfd00"],
      [0xffff, "fdffff"],
      [0x10000, "fe00000100"],
      [0xffffffff, "feffffffff"],
      [0x100000000, "ff0000000001000000"],
      [Number.MAX_SAFE_INTEGER, "ffffffffffffff1f00"],
    ];

    it.each(vectors)("encodes and decodes %s as %s", (n, expected) => {
      const writer = new BufferWriter();
      writer.writeVarInt(n);
      expect(writer.buffer().toString("hex")).toBe(expected);

      const reader = new BufferReader(Buffer.from(expected, "hex"));
      expect(reader.readVarInt()).toBe(n);
      expect(reader.available()).toBe(0);
    });

    it("decodes from a non-zero offset and advances by the encoded length", () => {
      const reader = new BufferReader(Buffer.from("aabbfdfd00cc", "hex"), 2);
      expect(reader.readVarInt()).toBe(0xfd);
      expect(reader.offset).toBe(5);
      expect(reader.readUInt8()).toBe(0xcc);
    });

    it.each([
      ["fd0100", 1, 3],
      ["fe01000000", 1, 5],
      ["ff0100000000000000", 1, 9],
    ])("accepts the non-minimal encoding %s", (encoded, value, length) => {
      const reader = new BufferReader(Buffer.from(encoded, "hex"));
      expect(reader.readVarInt()).toBe(value);
      expect(reader.offset).toBe(length);
    });

    it.each([-1, Number.MAX_SAFE_INTEGER + 1, 1.5, Number.NaN])("refuses to encode %s", value => {
      expect(() => new BufferWriter().writeVarInt(value)).toThrow();
    });

    it.each([
      ["empty", ""],
      ["fd", "fd"],
      ["fd01", "fd01"],
      ["fe010203", "fe010203"],
      ["ff01020304050607", "ff01020304050607"],
    ])("refuses to decode the truncated VarInt %s", (_name, encoded) => {
      expect(() => new BufferReader(Buffer.from(encoded, "hex")).readVarInt()).toThrow(/./);
    });

    it("refuses to decode past the end of the buffer", () => {
      expect(() => new BufferReader(Buffer.from("00", "hex"), 1).readVarInt()).toThrow(/./);
    });

    it.each(["ff0000000000002000", "ffffffffffffffffff"])(
      "refuses to decode %s, above Number.MAX_SAFE_INTEGER",
      encoded => {
        expect(() => new BufferReader(Buffer.from(encoded, "hex")).readVarInt()).toThrow(/./);
      },
    );

    it.each([0, 1, 252, 253, 65535, 65536])("round trips a %i-byte var slice", length => {
      const slice = Buffer.alloc(length, 0x5a);
      const writer = new BufferWriter();
      writer.writeVarSlice(slice);
      const written = writer.buffer();
      const headerLength = length < 0xfd ? 1 : length <= 0xffff ? 3 : 5;

      expect(written).toHaveLength(headerLength + length);
      expect(new BufferReader(written).readVarSlice()).toEqual(slice);
    });

    it("reads a vector whose count needs a 3-byte VarInt", () => {
      const writer = new BufferWriter();
      writer.writeVarInt(300);
      for (let i = 0; i < 300; i++) writer.writeVarSlice(Buffer.from([i % 256]));

      const vector = new BufferReader(writer.buffer()).readVector();
      expect(vector).toHaveLength(300);
      expect(vector[299]).toEqual(Buffer.from([299 % 256]));
    });
  });
});
