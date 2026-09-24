<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('tracking_settings', function (Blueprint $table) {
            $table->id();
            $table->boolean('session')->default(true);
            $table->boolean('usage')->default(true);
            $table->boolean('project')->default(true);
            $table->boolean('model')->default(true);
            $table->boolean('device')->default(true);
            $table->boolean('account')->default(true);
            $table->boolean('prompt')->default(false);
            $table->boolean('git')->default(false);
            $table->boolean('network')->default(false);
            $table->string('initial_sync_range', 8)->default('7d');
            $table->unsignedInteger('sync_interval_seconds')->default(120);
            $table->unsignedInteger('heartbeat_interval_seconds')->default(300);
            $table->string('min_agent_version', 32)->default('1.0.0');
            $table->unsignedInteger('retention_days')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->foreignId('updated_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });

        DB::table('tracking_settings')->insert([
            'id' => 1,
            'version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('tracking_settings');
    }
};
