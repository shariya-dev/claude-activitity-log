<?php

use App\Providers\AppServiceProvider;
use App\Providers\FortifyServiceProvider;
use App\Providers\MonitorAuthServiceProvider;

return [
    AppServiceProvider::class,
    FortifyServiceProvider::class,
    MonitorAuthServiceProvider::class,
];
