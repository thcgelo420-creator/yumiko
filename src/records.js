// The record collection. Edit this file to change what is in the room.
//
// Each record is one sleeve on the wall. A track is either
//   { title, yt: '<YouTube video id>' }   streamed from YouTube's own player, or
//   { title, src: 'music/file.mp3' }      an audio file you host next to this site.
// `colors` tint the printed sleeve and the label on the disc. `cover` is optional: an image
// URL for the sleeve; without it the sleeve uses the first track's video thumbnail.

export const RECORDS = [
  {
    id: 'peep-a',
    artist: 'Lil Peep',
    title: 'come over',
    colors: ['#d8a7b4', '#3a2230'],
    tracks: [
      { title: 'Star Shopping', yt: 'm8QQR-wQA0I' },
      { title: 'Benz Truck (гелик)', yt: '3rkJ3L5Ce80' },
      { title: 'Save That Shit', yt: 'WvV5TbJc9tQ' },
      { title: 'Awful Things (feat. Lil Tracy)', yt: 'zOujzvtwZ6M' },
      { title: 'The Brightside', yt: 'xAMgQQMZ9Lk' },
      { title: 'Life Is Beautiful', yt: '2ORsrbQa94M' },
      { title: 'When I Lie', yt: 'eIDySR4SFZI' },
    ],
  },
  {
    id: 'peep-b',
    artist: 'Lil Peep',
    title: 'hellboy days',
    colors: ['#9b2c3a', '#16090c'],
    tracks: [
      { title: 'beamer boy', yt: 'fePnUenEZPk' },
      { title: 'hellboy', yt: 's9t1ZfMZfH4' },
      { title: 'crybaby', yt: 'inocgEraxo0' },
      { title: 'nineteen', yt: 'PI6YVmL6U68' },
      { title: 'witchblades (with Lil Tracy)', yt: 'E7sP6t1QyrI' },
    ],
  },
  {
    id: 'smokedope',
    artist: 'smokedope2016',
    title: '2016 lyfe',
    colors: ['#7f8f5a', '#11160d'],
    tracks: [
      { title: 'Eastbay', yt: 'Q2AFZH-m3WQ' },
      { title: 'Taipei / Waterbed', yt: 'jB59JVNstiY' },
      { title: 'MY CHALICE', yt: 'g7MHFBu0PI8' },
      { title: 'Frat', yt: 'U78wNnzjCtU' },
      { title: 'DRAFT NIGHT #THEPEAK', yt: 'qvaovHtrfgg' },
      { title: '2016LYFE', yt: 'PXHm-sQCzko' },
      { title: 'ICEY SOLES', yt: 'QCz-Xem4M-Y' },
      { title: '#KHALIFA', yt: 'SLoLQLyZmEQ' },
    ],
  },
  {
    id: 'lean',
    artist: 'Yung Lean',
    title: 'sad boys',
    colors: ['#6fb7c9', '#10202b'],
    tracks: [
      { title: 'Ginseng Strip 2002', yt: 'vrQWhFysPKY' },
      { title: 'Kyoto', yt: 'tMgkt9jdjTU' },
      { title: 'Yoshi City', yt: 'iX1a3JngmpI' },
      { title: 'Agony', yt: 'hEWPmWprx7Y' },
    ],
  },
  {
    id: 'bladee',
    artist: 'Bladee',
    title: 'drain',
    colors: ['#c9cfe0', '#39415c'],
    ink: 'rgba(16,20,34,0.92)',
    tracks: [
      { title: 'Be Nice 2 Me', yt: 'vcAp4nmTZCA' },
      { title: 'Obedient (with Ecco2k)', yt: '2KkMyDSrBVI' },
      { title: 'Who Goes There', yt: 'mXxr58D-WiM' },
      { title: 'Into Dust', yt: 'QX_GQvxqf4M' },
    ],
  },
  {
    id: 'bones',
    artist: 'Bones',
    title: 'sesh',
    colors: ['#4a4a4a', '#0a0a0a'],
    tracks: [
      { title: 'HDMI', yt: '5souw4K5UQc' },
      { title: 'Dirt', yt: '0IYght7FGdg' },
      { title: 'CtrlAltDelete', yt: 'kM8LC3Nj7-s' },
    ],
  },
];

// The last sleeve is blank card: tracks the visitor adds themselves live here.
export const OWN_RECORD = {
  id: 'own',
  artist: 'your own',
  title: 'blank sleeve',
  colors: ['#b9a98c', '#5b4d3a'],
  ink: 'rgba(30,24,16,0.9)',
  own: true,
  tracks: [],
};

export const ALL_RECORDS = [...RECORDS, OWN_RECORD];
