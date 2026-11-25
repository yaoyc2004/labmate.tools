/* labmate.tools — 10.1 Protocol Timeline Planner: built-in protocol templates.
 * Typical times for a common version of each protocol, to be edited to match your kit, antibody and lab.
 * Fields: see timeline-core.js. dur/min/max/head/tail/buf in minutes. hands: true = you are busy the whole step.
 * `ref` lists public protocols the step order and typical times were checked against.
 */
(function (root) {
  'use strict';
  var T = [
    {
      id: 'wb', name: 'Western blot', short: 'WB', note: 'Overnight primary at 4 °C. Change the primary to 1–2 h at room temperature for a one-day blot.',
      ref: [['CST western blotting protocol', 'https://www.cellsignal.com/learn-and-support/protocols/protocol-western'], ['Addgene western blot protocol', 'https://www.addgene.org/protocols/western-blot']],
      steps: [
        { name: 'Prepare samples (sample buffer, heat)', dur: 30, hands: true },
        { name: 'Load the gel', dur: 15, hands: true },
        { name: 'Run the gel', dur: 90, min: 60, max: 120, head: 2 },
        { name: 'Assemble the transfer sandwich', dur: 20, hands: true },
        { name: 'Wet transfer', dur: 90, min: 60, max: 120, head: 2, tail: 5 },
        { name: 'Block', dur: 60, min: 60, max: 120, head: 3, note: '5% milk or BSA in TBST' },
        { name: 'Primary antibody, 4 °C overnight', dur: 960, min: 720, max: 1080, head: 5 },
        { name: 'Wash in TBST, 3 × 10 min', dur: 30, reps: 3, head: 2 },
        { name: 'Secondary antibody, room temperature', dur: 60, min: 45, max: 90, head: 3 },
        { name: 'Wash in TBST, 3 × 10 min', dur: 30, reps: 3, head: 2 },
        { name: 'ECL and imaging', dur: 20, hands: true }
      ]
    },
    {
      id: 'ihc', name: 'IHC on paraffin sections (DAB)', short: 'IHC-P', note: 'Primary 1 h at room temperature. For overnight at 4 °C set it to 16 h, window 12–18 h.',
      ref: [['CST IHC protocol, paraffin (SignalStain)', 'https://www.cellsignal.com/learn-and-support/protocols/protocol-ihc-paraffin-signalstain']],
      steps: [
        { name: 'Bake slides', dur: 30, min: 20, max: 60, head: 2 },
        { name: 'Dewax and rehydrate (xylene, ethanol series)', dur: 30, reps: 6, head: 1 },
        { name: 'Heat antigen retrieval', dur: 20, min: 15, max: 30, head: 5 },
        { name: 'Cool in retrieval buffer', dur: 20, min: 20, max: 40 },
        { name: 'Wash, 2 × 5 min', dur: 10, reps: 2, head: 1 },
        { name: 'Block endogenous peroxidase', dur: 10, head: 2 },
        { name: 'Wash, 2 × 5 min', dur: 10, reps: 2, head: 1 },
        { name: 'Block with serum', dur: 30, min: 30, max: 60, head: 3 },
        { name: 'Primary antibody', dur: 60, min: 60, max: 120, head: 5 },
        { name: 'Wash, 3 × 5 min', dur: 15, reps: 3, head: 1 },
        { name: 'HRP polymer / secondary', dur: 30, min: 30, max: 60, head: 3 },
        { name: 'Wash, 3 × 5 min', dur: 15, reps: 3, head: 1 },
        { name: 'DAB, watch under the microscope', dur: 10, hands: true },
        { name: 'Counterstain with hematoxylin', dur: 10, hands: true },
        { name: 'Dehydrate, clear and mount', dur: 20, hands: true }
      ]
    },
    {
      id: 'if', name: 'Immunofluorescence on cells', short: 'IF', note: 'Cells on coverslips or chamber slides; overnight primary at 4 °C.',
      ref: [['Addgene immunocytochemistry protocol', 'https://addgene.org/protocols/immunocytochemistry']],
      steps: [
        { name: 'Fix in 4% PFA', dur: 15, min: 10, max: 20, head: 3 },
        { name: 'Wash in PBS, 3 × 5 min', dur: 15, reps: 3, head: 1 },
        { name: 'Permeabilise (0.1% Triton X-100)', dur: 10, head: 2 },
        { name: 'Block', dur: 60, min: 30, max: 120, head: 2 },
        { name: 'Primary antibody, 4 °C overnight', dur: 960, min: 720, max: 1080, head: 5 },
        { name: 'Wash in PBS, 3 × 5 min', dur: 15, reps: 3, head: 1 },
        { name: 'Secondary antibody, in the dark', dur: 60, min: 45, max: 90, head: 3 },
        { name: 'Wash in PBS, 3 × 5 min', dur: 15, reps: 3, head: 1 },
        { name: 'DAPI', dur: 5, hands: true },
        { name: 'Mount', dur: 15, hands: true }
      ]
    },
    {
      id: 'lipo', name: 'Lipofection (transient transfection)', short: 'Transfection', note: 'Seed the day before. Delete the medium change if your reagent does not need it.',
      ref: [['Lipofectamine 3000 protocol (Thermo Fisher)', 'https://assets.thermofisher.cn/TFS-Assets/LSG/manuals/lipofectamine3000_protocol.pdf']],
      steps: [
        { name: 'Seed cells', dur: 30, hands: true },
        { name: 'Cells attach and grow', dur: 1200, min: 1080, max: 1440 },
        { name: 'Dilute DNA and reagent', dur: 10, hands: true },
        { name: 'Form complexes', dur: 15, min: 10, max: 20 },
        { name: 'Add complexes to the cells', dur: 10, hands: true },
        { name: 'Incubate with complexes', dur: 300, min: 240, max: 360 },
        { name: 'Change the medium', dur: 15, hands: true },
        { name: 'Expression', dur: 2880, min: 1440, max: 4320, note: 'Usually 24–72 h' },
        { name: 'Harvest', dur: 30, hands: true }
      ]
    },
    {
      id: 'elisa', name: 'Sandwich ELISA (pre-coated plate)', short: 'ELISA', note: 'Follow your kit insert: kit incubation times are fixed.',
      ref: [['Thermo Fisher basic sandwich ELISA protocol', 'https://www.thermofisher.com/us/en/home/references/protocols/cell-and-tissue-analysis/elisa-protocol/general-elisa-protocol/basic-sandwich-elisa-protocol'], ['R&D Systems sandwich ELISA protocol', 'https://www.rndsystems.com/resources/protocols/elisa-direct-sandwich-protocol']],
      steps: [
        { name: 'Prepare standards and samples', dur: 30, hands: true },
        { name: 'Samples and standards on the plate', dur: 120, head: 15 },
        { name: 'Wash 4×', dur: 5, hands: true },
        { name: 'Detection antibody', dur: 60, head: 5 },
        { name: 'Wash 4×', dur: 5, hands: true },
        { name: 'Streptavidin-HRP', dur: 30, head: 5 },
        { name: 'Wash 4×', dur: 5, hands: true },
        { name: 'TMB substrate, in the dark', dur: 20, min: 15, max: 30, head: 3 },
        { name: 'Stop and read the plate', dur: 10, hands: true }
      ]
    },
    {
      id: 'coip', name: 'Co-immunoprecipitation', short: 'Co-IP', note: 'Antibody 2 h at 4 °C; overnight also works (window up to 18 h). Elute into sample buffer and continue with a western blot.',
      ref: [['Addgene protocols', 'https://addgene.org/protocols']],
      steps: [
        { name: 'Lyse cells on ice', dur: 30, min: 20, max: 40, head: 10 },
        { name: 'Clear the lysate (spin, 4 °C)', dur: 15, head: 3, tail: 3 },
        { name: 'Pre-clear with beads', dur: 60, min: 30, max: 60, head: 5 },
        { name: 'Antibody, 4 °C rotating', dur: 120, min: 60, max: 1080, head: 3 },
        { name: 'Add beads, 4 °C rotating', dur: 60, min: 60, max: 120, head: 3 },
        { name: 'Wash beads 4×', dur: 20, hands: true },
        { name: 'Elute in sample buffer', dur: 15, hands: true }
      ]
    },
    {
      id: 'qpcr', name: 'RNA to qPCR', short: 'qPCR', note: 'Column RNA kit, two-step RT-qPCR.',
      ref: [['Addgene protocols', 'https://addgene.org/protocols']],
      steps: [
        { name: 'Extract RNA (column kit)', dur: 60, hands: true },
        { name: 'Measure RNA, set up DNase / RT', dur: 20, hands: true },
        { name: 'Reverse transcription (thermocycler)', dur: 60, min: 60, max: 240, head: 2 },
        { name: 'Set up the qPCR plate', dur: 30, hands: true },
        { name: 'qPCR run', dur: 100, min: 100, max: 600, head: 5, tail: 5 }
      ]
    },
    {
      id: 'mini', name: 'Plasmid miniprep', short: 'Miniprep', note: 'Overnight culture at 37 °C, shaking.',
      ref: [['Addgene protocols', 'https://addgene.org/protocols']],
      steps: [
        { name: 'Inoculate cultures', dur: 15, hands: true },
        { name: 'Overnight culture, 37 °C shaking', dur: 960, min: 720, max: 1080 },
        { name: 'Miniprep (spin kit)', dur: 45, hands: true },
        { name: 'Measure DNA', dur: 10, hands: true }
      ]
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
  else root.LMT_PROTOCOLS = T;
})(this);
