import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.chagok.car"
    compileSdk = 36

    // AAOS 표준 Car API(CarPropertyManager, CarUxRestrictionsManager).
    // 시동·기어·속도·연료 종류·주행 가능 거리는 Pleos Vehicle SDK에 없어서 여기서 읽는다.
    useLibrary("android.car")

    defaultConfig {
        applicationId = "com.chagok.car"
        // Pleos Connect 요구사항: minSdk 28 이상, 플랫폼은 API 34
        minSdk = 28
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("ai.pleos.playground:Vehicle:2.3.2")
    implementation("ai.pleos.playground:NaviHelper:3.0.5")
    implementation("ai.pleos.playground:FusedLocation:1.1.3")
    implementation("ai.pleos.playground:TextToSpeech:3.3.1")
    implementation("ai.pleos.playground:SpeechToText:3.3.1")

    testImplementation("junit:junit:4.13.2")
    // JVM 단위 테스트에서는 android.jar의 org.json이 스텁이라 실제 구현을 쓴다(SnapshotCodec 테스트)
    testImplementation("org.json:json:20231013")
}
