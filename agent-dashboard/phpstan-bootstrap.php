<?php

// Larastan boots the application in every parallel worker; the default CLI
// memory_limit (128M on Homebrew PHP) is not enough for that.
$limit = (string) ini_get('memory_limit');

if ($limit !== '-1' && ini_parse_quantity($limit) < 512 * 1024 * 1024) {
    ini_set('memory_limit', '512M');
}
