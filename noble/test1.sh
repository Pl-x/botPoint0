# Test phone number (sandbox)
curl -X POST http://localhost:3000/api/payment/mpesa \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTc0NzI1MDAyMSwiZXhwIjoxNzQ3MzM2NDIxfQ.GZbC-feNj44rwBuvQvXaStqz94DbRXfzIvV43vLdqHA" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "phoneNumber": "254794869383"
  }'
