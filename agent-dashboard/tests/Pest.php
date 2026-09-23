<?php

use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| Feature tests run against the Laravel application. Each test file opts
| into database refreshing itself with uses(RefreshDatabase::class).
|
*/

pest()->extend(TestCase::class)->in('Feature');
