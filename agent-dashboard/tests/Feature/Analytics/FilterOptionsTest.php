<?php

use App\Models\ClaudeAccount;
use App\Models\ClaudeModel;
use App\Models\Developer;
use App\Models\Device;
use App\Models\Project;
use App\Queries\Analytics\Dimension;
use App\Queries\Analytics\FilterOptions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->zara = Developer::factory()->create(['name' => 'Zara', 'email' => 'zara@6am.test']);
    $this->amir = Developer::factory()->create(['name' => 'Amir', 'email' => 'amir@6am.test']);
    $this->former = Developer::factory()->create(['name' => 'Former', 'email' => 'former@6am.test']);
    $this->former->delete();

    $this->mac = Device::factory()->for($this->zara)->create(['hostname' => 'zara-mbp', 'platform' => 'macos']);
    $this->nameless = Device::factory()->for($this->amir)->create(['hostname' => null, 'platform' => 'windows']);

    $this->byEmail = ClaudeAccount::factory()->for($this->zara)->create(['email' => 'zara@claude.test', 'display_name' => 'Zara Z']);
    $this->byName = ClaudeAccount::factory()->for($this->zara)->create(['email' => null, 'display_name' => 'Zara Personal']);
    $this->anonymous = ClaudeAccount::factory()->for($this->amir)->create(['email' => null, 'display_name' => null]);

    $this->project = Project::factory()->create(['name' => 'Billing-Api']);
    $this->model = ClaudeModel::factory()->create(['name' => 'claude-sonnet-4-5']);
});

test('options are keyed by dimension value with documented labels, sorted by label', function () {
    $options = app(FilterOptions::class)->for(Dimension::cases());

    expect(array_keys($options))->toBe(['developer', 'device', 'account', 'project', 'model'])
        ->and($options['developer'])->toBe([
            ['id' => $this->amir->id, 'label' => 'Amir <amir@6am.test>'],
            ['id' => $this->former->id, 'label' => 'Former <former@6am.test>'],
            ['id' => $this->zara->id, 'label' => 'Zara <zara@6am.test>'],
        ])
        ->and($options['device'])->toContain(['id' => $this->mac->id, 'label' => 'zara-mbp (macos)'])
        ->and($options['device'])->toContain(['id' => $this->nameless->id, 'label' => $this->nameless->device_uid.' (windows)'])
        ->and($options['account'])->toBe([
            ['id' => $this->anonymous->id, 'label' => "Account #{$this->anonymous->id}"],
            ['id' => $this->byName->id, 'label' => 'Zara Personal'],
            ['id' => $this->byEmail->id, 'label' => 'zara@claude.test'],
        ])
        ->and($options['project'])->toBe([['id' => $this->project->id, 'label' => 'Billing-Api']])
        ->and($options['model'])->toBe([['id' => $this->model->id, 'label' => 'claude-sonnet-4-5']]);
});

test('only the requested dimensions are loaded, one query each', function () {
    DB::enableQueryLog();
    $options = app(FilterOptions::class)->for([Dimension::Project, Dimension::Model]);
    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect(array_keys($options))->toBe(['project', 'model'])
        ->and($queries)->toBe(2)
        ->and(app(FilterOptions::class)->for([]))->toBe([]);
});
