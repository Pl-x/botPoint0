// Write a program that takes an integer as input and returns an integer with reversed digit
// ordering
function reverse()
{
let input = prompt("enter an integer")
let output = parseInt(input.toString().split("").reverse().join(""))
if(input < 0)
{
    output = -output
}
console.log(input,": ",output)
alert(input + " reversed to " + output)
}
reverse()