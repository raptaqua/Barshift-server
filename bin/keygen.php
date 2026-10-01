<?php
// Luo Ed25519-avainpari baarille. Julkinen avain rekisteröidään keskukseen (bin/add_pub.php), yksityinen avain jää baarin asennukseen.
$kp = sodium_crypto_sign_keypair();
echo "public_key:  " . base64_encode(sodium_crypto_sign_publickey($kp)) . "\n";
echo "private_key: " . base64_encode(sodium_crypto_sign_secretkey($kp)) . "   (SALAINEN, vain baarin asennukseen)\n";
