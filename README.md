# yumiko

A small 3D room to hang around in while it rains. Walk about, lie on the bed and watch the
city through wet glass, sit at the desk, switch the lamp on, and put a record on the turntable.

It is a static site: plain HTML, CSS and ES modules, with [three.js](https://threejs.org)
vendored in `vendor/`. There is no build step and nothing to install.

## Run it

```sh
./serve.sh            # http://localhost:8930
```

Any static file server works (`python3 -m http.server`, GitHub Pages, Netlify, …). Opening
`index.html` straight from disk does not, because browsers block ES modules on `file://`.

## Controls

| | |
|---|---|
| `W` `A` `S` `D` / arrows | walk (`Shift` to go slowly) |
| mouse | look (click the room to capture the mouse; drag also works) |
| `E` or click | use what you are looking at: bed, stool, lamp, a sleeve on the wall, the deck |
| `R` | open the record crate |
| `Space` | play / pause |
| `N` / `B` | next / previous track |
| `V` | show or hide the video in the now-playing card |
| `L` | lamp |
| `Esc` | menu (volumes, look speed, thunder, lighter graphics) |

On a phone: the left pad walks, dragging looks, tapping uses.

## The records

The collection lives in [`src/records.js`](src/records.js). Each record is a sleeve on the wall
with a list of tracks:

```js
{
  id: 'peep-a',
  artist: 'Lil Peep',
  title: 'come over',
  colors: ['#d8a7b4', '#3a2230'],            // sleeve tint and label colour
  tracks: [
    { title: 'Star Shopping', yt: 'm8QQR-wQA0I' },   // a YouTube video id
    { title: 'my own song', src: 'music/song.mp3' }, // or a file hosted with the site
  ],
}
```

Music is not bundled. `yt` tracks stream through YouTube's own embedded player (shown small in
the now-playing card), so they need a connection and only work for uploads that allow
embedding. The sleeve art is that video's thumbnail unless you give the record a `cover` URL.

The last sleeve on the wall is blank and belongs to the visitor: paste a YouTube link into it,
or drop audio files anywhere on the page. Those are stored in that browser only
(localStorage and IndexedDB).

## How it is put together

| file | what it does |
|---|---|
| `src/main.js` | renderer, lights, post-processing, input, the play/stop logic |
| `src/room.js` | the room and everything in it, colliders, things you can use |
| `src/outside.js` | sky, city, traffic and falling rain, drawn to a texture |
| `src/glass.js` | the window shader: looks that texture up through mist and water drops |
| `src/turntable.js` | the deck and its arm, platter and record animations |
| `src/audio.js` | synthesised rain, crackle and thunder; the YouTube / file player |
| `src/player.js` | walking, collisions, and the lie / sit poses |
| `src/ui.js`, `css/style.css` | menu, prompts, now-playing card, crate sheet |
| `src/textures.js` | every texture, painted on canvases at load |

Rain, thunder and vinyl crackle are generated in the browser; no audio or image files ship
with the site.
