// Question 3: Power of Two
// Write a program that takes an integer as input and returns true if the input is a power of two.
function ispowerof2() {
  let number = prompt("enter an integer")
  return Math.log2(number)%1===0
}
alert(number + " : " ispowerof2(number))
console.log(number,ispowerof2(number))
