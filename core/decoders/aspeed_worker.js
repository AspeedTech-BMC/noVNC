/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2021 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

import {decode} from "../../vendor/aspeed/lib/decoder.js";

self.addEventListener('message', function(e) {
    let outbuf = decode(e.data.header, e.data.buffer);
    if (outbuf) {
        let copy = outbuf.slice();

        postMessage({
            width: e.data.header.width,
            height: e.data.header.height,
            buffer: copy
        }, [copy.buffer]);
    }
});
