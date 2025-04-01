// Question 3: Power of Two
// Write a program that takes an integer as input and returns true if the input is a power of two.
function ispowerof2(number) {
  return Math.log2(number)%1===0
}
// for loop to simulate a range of user inputs
for(let number=0;number<=100;number++)
{
console.log(number,ispowerof2(number))
}